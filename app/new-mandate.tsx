// New mandate modal: Budget → Stocks → Rules → Who starts a trade → (automatic only) Instructions,
// then a review sheet that replaces the old Alert as the financial confirmation.
// Review renders inside this screen so wallet auth has no nested native sheet.
// Completed approvals survive interruptions while this draft remains open.
// A chat mandate signs the USDC budget only; each stock's sell permission is signed on its first sell
// (see app/(tabs)/agent.tsx). An automatic mandate must exit positions unattended, so it signs every stock now.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Alert } from '@/lib/browser-dialogs';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { Body, Button, Caption, Card, Chip, H2, Logo, LogoStack, Muted, Screen } from '@/components/ui';
import { Banner, ChoiceRow, ConfirmSheet, DetailRow, Field, ModeLine, PreviewBanner, appStyles } from '@/components/app-ui';
import { useWallet, signTypedData, signInMessage } from '@/lib/wallet';
import { api, APIError, backendUrl, type AgentInfo, type AIDraft, type DraftInput, type Mandate, type Risk } from '@/lib/api';
import { STOCKS, type Address, type Stock } from '@/lib/stocks';
import { signPermissions, type PeriodKey } from '@/lib/spendPermission';
import { prepareApprovalDraft, type ApprovalDraft } from '@/lib/approval-draft';
import { PREVIEW_ACCOUNT } from '@/lib/preview';
import { shortAddr } from '@/lib/chain';
import { colors, inset, money, space } from '@/lib/theme';
import { approvalPlan, controlLabel, modeLabel, periodPhrase, riskLabel, shortDate, stockGridColumns } from '@/lib/ui-presentation';

type Control = 'chat' | 'automatic';

const BUDGETS = [25, 50, 100, 250, 500];
const PERIODS: PeriodKey[] = ['daily', 'weekly', 'monthly'];
const DURATIONS = [7, 30, 90];
const RISKS: Risk[] = ['conservative', 'balanced', 'aggressive'];
const MAX_BUDGET = 1_000_000;
const RISK_PRESET: Record<Risk, { maxPositionPct: number; takeProfitPct: number; stopLossPct: number; blurb: string }> = {
  conservative: { maxPositionPct: 25, takeProfitPct: 6, stopLossPct: 4, blurb: 'Mega-caps, small sizes, quick to take profit.' },
  balanced: { maxPositionPct: 40, takeProfitPct: 10, stopLossPct: 7, blurb: 'Buys dips, holds winners, trims on strength.' },
  aggressive: { maxPositionPct: 60, takeProfitPct: 20, stopLossPct: 12, blurb: 'Concentrated, momentum-driven, wider stops.' },
};
const DEFAULT_UNIVERSE = ['NVDAc', 'AAPLc', 'MSFTc', 'GOOGLc', 'TSLAc'];
const DEFAULT_INSTRUCTIONS = 'Buy quality tech on red days, take profits into strength, never chase a stock up more than 3% intraday.';
// The chat backend never sends instructions to the model, so a chat mandate stores a fixed description instead.
const CHAT_STRATEGY = 'Chat mandate: every trade is prepared in chat and confirmed by the account owner.';
// Mirrors agent/src/admission.ts so the form refuses before any wallet prompt; the server still enforces both.
const MAX_ACTIVE_MANDATES = 5;
const CREATION_COOLDOWN_S = 30;

// ---- Form state --------------------------------------------------------------

function useMandateForm() {
  const [budget, setBudget] = useState(100);
  const [custom, setCustom] = useState(false);
  const [customBudget, setCustomBudget] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('weekly');
  const [duration, setDuration] = useState(30);
  const [universe, setUniverse] = useState<Set<string>>(() => new Set(DEFAULT_UNIVERSE));
  const [risk, setRisk] = useState<Risk>('balanced');
  const [control, setControl] = useState<Control>('chat');
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);

  const effectiveBudget = custom ? Number(customBudget) || 0 : budget;
  const validBudget = Number.isFinite(effectiveBudget) && effectiveBudget > 0 && effectiveBudget <= MAX_BUDGET;
  const selected = useMemo(() => STOCKS.filter(s => universe.has(s.symbol)), [universe]);
  const symbols = useMemo(() => selected.map(s => s.symbol), [selected]);
  const tokens = useMemo(() => selected.map(s => s.token), [selected]);
  const preset = RISK_PRESET[risk];
  const strategy = control === 'chat' ? CHAT_STRATEGY : instructions;
  const dirty = custom || customBudget !== '' || budget !== 100 || period !== 'weekly' || duration !== 30 || risk !== 'balanced'
    || control !== 'chat' || instructions !== DEFAULT_INSTRUCTIONS
    || universe.size !== DEFAULT_UNIVERSE.length || DEFAULT_UNIVERSE.some(s => !universe.has(s));

  const pickBudget = (value: number) => { setBudget(value); setCustom(false); };
  const toggleStock = (symbol: string) => setUniverse(prev => {
    const next = new Set(prev);
    if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
    return next;
  });
  const selectAll = () => setUniverse(new Set(STOCKS.map(s => s.symbol)));
  const clearAll = () => setUniverse(new Set());

  return {
    budget, custom, customBudget, period, duration, universe, risk, control, instructions,
    effectiveBudget, validBudget, symbols, tokens, preset, strategy, dirty,
    pickBudget, setCustom, setCustomBudget, setPeriod, setDuration, setRisk, setControl, setInstructions, toggleStock, selectAll, clearAll,
  };
}
type MandateForm = ReturnType<typeof useMandateForm>;

/** Seconds until the backend admits another mandate. Ticks only while a cooldown is running. */
function useCooldown(until: number) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  const active = until > now;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, [active, until]);
  return active ? Math.ceil(until - now) : 0;
}

function useAdmission(mandates: Mandate[] | undefined) {
  const active = mandates?.filter(m => m.status === 'active' || m.status === 'pending').length ?? 0;
  const newest = mandates?.reduce((max, m) => Math.max(max, m.createdAt), 0) ?? 0;
  const cooldown = useCooldown(newest + CREATION_COOLDOWN_S);
  return { atLimit: active >= MAX_ACTIVE_MANDATES, cooldown };
}

// ---- Presenters --------------------------------------------------------------

const ticker = (symbol: string) => symbol.replace(/c$/, '');
const stockCount = (n: number) => `${n} ${n === 1 ? 'stock' : 'stocks'}`;
const expiryUnix = (durationDays: number) => Math.floor(Date.now() / 1000) + durationDays * 86400;

function budgetSentence(dryRun: boolean, amount: number, period: PeriodKey) {
  return dryRun
    ? `Up to ${money(amount, 0)} virtual USDC ${periodPhrase[period]}. Real funds are untouched.`
    : `On-chain cap: ${money(amount, 0)} ${periodPhrase[period]}. Sell allowances are separate.`;
}

function draftHint(agent: AgentInfo | undefined) {
  if (!agent?.ai.configured) return 'Connect OpenRouter in Settings → AI settings to draft instructions.';
  if (agent.ai.developmentSettings) return 'AI drafts from your budget, stocks and rules. Review before applying.';
  return 'For AI drafting, connect a development backend in Settings → AI settings.';
}

// ---- Screen ------------------------------------------------------------------

export default function NewMandate() {
  const router = useRouter();
  const qc = useQueryClient();
  const address = useWallet(s => s.address)!;
  const isPreview = address.toLowerCase() === PREVIEW_ACCOUNT.toLowerCase();
  const form = useMandateForm();
  const [reviewing, setReviewing] = useState(false);
  const [signingStep, setSigningStep] = useState('');
  const [draftText, setDraftText] = useState('');
  const approvalDraft = useRef<ApprovalDraft | undefined>(undefined);
  const submitting = useRef(false);
  const [approved, setApproved] = useState(0);
  const [setupError, setSetupError] = useState('');

  const agent = useQuery({ queryKey: ['agent'], queryFn: api.agent });
  const mandates = useQuery({ queryKey: ['mandates', address], queryFn: () => api.mandates(address) });
  const admission = useAdmission(mandates.data);
  const dryRun = agent.data?.dryRun;

  const draftInput: DraftInput = {
    instructions: form.instructions, budgetUsdc: form.effectiveBudget, period: form.period, symbols: form.symbols, risk: form.risk,
    maxPositionPct: form.preset.maxPositionPct, takeProfitPct: form.preset.takeProfitPct, stopLossPct: form.preset.stopLossPct,
  };
  const draft = useMutation({
    mutationFn: (input: DraftInput) => api.draftInstructions(input),
    onSuccess: result => setDraftText(result.strategy),
  });
  const draftIsStale = !!draft.data && JSON.stringify(draft.variables) !== JSON.stringify(draftInput);

  const create = useMutation({
    mutationFn: async () => {
      setSetupError('');
      if (!agent.data) throw new Error('Agent is offline. Start the agent server first.');
      if (!form.validBudget) throw new Error('Set a budget between 0 and 1,000,000 USDC.');
      if (form.tokens.length === 0) throw new Error('Pick at least one stock.');
      let spender = agent.data.spender;
      let verified = false;
      try { await api.session(); } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        setSigningStep('Verify your wallet to save this mandate…');
        await api.verifyWallet(address, message => signInMessage(address, message));
        await qc.invalidateQueries({ queryKey: ['session'] });
        verified = true;
      }
      // The backend rejects any other spender, and it answers null to a request without a session: after signing in, or when
      // the cached /agent was fetched without one, ask again rather than build the batch on a stale answer.
      if (verified || !spender) {
        setSigningStep('Preparing your agent account…');
        spender = (await api.agent()).spender;
        void qc.invalidateQueries({ queryKey: ['agent'] });
      }
      if (!spender) throw new Error('Verify your wallet first so Mandate can prepare your agent account.');
      const approval = prepareApprovalDraft(approvalDraft.current, {
        account: address, spender, budgetUsdc: form.effectiveBudget, period: form.period,
        universe: form.tokens, durationDays: form.duration, includeSellPermissions: form.control === 'automatic',
      }, JSON.stringify([backendUrl(), agent.data.dryRun, form.control, form.strategy, form.risk, form.preset]));
      approvalDraft.current = approval;
      setApproved(approval.batch.permissions.filter(p => p.signature).length);
      if (!agent.data.dryRun) {
        approval.batch = await signPermissions(approval.batch, signTypedData, (index, total, token) => {
          const symbol = STOCKS.find(s => s.token.toLowerCase() === token.toLowerCase())?.symbol ?? 'USDC';
          setSigningStep(`Approve ${symbol} in Coinbase · ${index} of ${total}`);
        }, batch => {
          approval.batch = batch;
          setApproved(batch.permissions.filter(p => p.signature).length);
        });
      }
      const signedBatch = approval.batch;
      setSigningStep('Saving your mandate…');
      // Recover a saved mandate if the previous response was lost. Retrying
      // retains the random salt and does not create a second mandate.
      const existing = (await api.mandates(address)).find(m =>
        m.batch.account.toLowerCase() === address.toLowerCase()
        && m.batch.start === signedBatch.start && m.batch.end === signedBatch.end
        && m.batch.permissions[0]?.salt === signedBatch.permissions[0].salt);
      if (existing) return existing;
      setSigningStep('Saving your mandate…');
      const { maxPositionPct, takeProfitPct, stopLossPct } = form.preset;
      return api.createMandate({
        account: address, control: form.control, budgetUsdc: form.effectiveBudget, period: form.period, universe: form.tokens,
        strategy: form.strategy, risk: form.risk, maxPositionPct, takeProfitPct, stopLossPct, batch: signedBatch,
      });
    },
    onSuccess: m => {
      qc.invalidateQueries({ queryKey: ['mandates'] });
      setReviewing(false);
      router.dismiss();
      if (form.control === 'chat') router.navigate({ pathname: '/(tabs)/agent', params: { mandateId: m.id, created: '1', nonce: String(Date.now()) } });
      else router.push(`/mandate/${m.id}`);
    },
    onError: (e: Error) => {
      setApproved(approvalDraft.current?.batch.permissions.filter(p => p.signature).length ?? 0);
      setSetupError(e.message || 'Setup was interrupted. Please try again.');
    },
    onSettled: () => { submitting.current = false; setSigningStep(''); },
  });
  const creating = create.isPending;

  const edit = () => {
    if (creating || submitting.current) return;
    setReviewing(false);
    setSetupError('');
    setApproved(0);
  };
  const confirm = () => {
    if (submitting.current) return;
    submitting.current = true;
    create.mutate();
  };
  const cancel = () => {
    if (creating || submitting.current) return;
    if (reviewing) { edit(); return; }
    if (!form.dirty) { router.back(); return; }
    Alert.alert('Discard this mandate?', undefined, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  return (
    <Screen style={styles.fill}>
      {/* Swipe-to-dismiss cannot show the discard guard, so it is off once there is something to lose. */}
      <Stack.Screen options={{
        title: 'New mandate', gestureEnabled: !form.dirty && !creating, headerLeft: () => <HeaderCancel onPress={cancel} disabled={creating} />,
      }} />
      {reviewing ? (
        <ReviewSheet visible inline onClose={edit} form={form} dryRun={dryRun} spender={agent.data?.spender}
          signingStep={signingStep} creating={creating} approved={approved} error={setupError} onConfirm={confirm} />
      ) : <>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets contentContainerStyle={styles.content}>
        <View style={styles.status}>
          <PreviewBanner />
          <ModeLine dryRun={dryRun} />
          {agent.isError ? (
            <Banner tone="red" icon="wifi.exclamationmark" text={agent.error.message} action={{ label: 'Retry', onPress: () => agent.refetch() }} />
          ) : null}
        </View>
        <BudgetSection form={form} dryRun={dryRun} />
        <StocksSection form={form} />
        <RulesSection form={form} />
        <ControlSection form={form} aiConfigured={agent.data?.ai.configured} onConnect={() => router.push('/ai-settings')} />
        {form.control === 'automatic' ? (
          <InstructionsSection form={form} agent={agent.data} draft={draft} draftInput={draftInput} draftIsStale={draftIsStale}
            draftText={draftText} onDraftText={setDraftText} creating={creating} />
        ) : null}
      </ScrollView>
      <Footer form={form} agent={agent} admission={admission} isPreview={isPreview} draftPending={draft.isPending} creating={creating}
        signingStep={signingStep} onReview={() => setReviewing(true)} />
      </>}
    </Screen>
  );
}

function HeaderCancel({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Cancel" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={8}
      style={({ pressed }) => [styles.headerButton, disabled && { opacity: 0.45 }, pressed && { opacity: 0.6 }]}>
      <Body style={{ color: colors.link, fontSize: 17 }}>Cancel</Body>
    </Pressable>
  );
}

// ---- Sections ----------------------------------------------------------------

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={styles.labeled}><Muted>{label}</Muted>{children}</View>;
}

function BudgetSection({ form, dryRun }: { form: MandateForm; dryRun: boolean | undefined }) {
  return (
    <Card style={appStyles.section}>
      <View style={styles.heading}>
        <H2 accessibilityRole="header">Budget</H2>
        <Muted>What the agent may spend, per period.</Muted>
      </View>
      <View style={appStyles.wrap}>
        {BUDGETS.map(b => <Chip key={b} label={money(b, 0)} active={!form.custom && form.budget === b} onPress={() => form.pickBudget(b)} />)}
        <Chip label="Custom" active={form.custom} onPress={() => form.setCustom(true)} />
      </View>
      {form.custom ? (
        <Field label="Custom amount (USDC)" error={form.validBudget ? undefined : 'Enter a positive amount up to 1,000,000 USDC.'}>
          <TextInput accessibilityLabel="Custom USDC budget" autoFocus value={form.customBudget} onChangeText={form.setCustomBudget} placeholder="e.g. 150"
            placeholderTextColor={colors.faint} keyboardType="decimal-pad" style={appStyles.input} />
        </Field>
      ) : null}
      <Labeled label="Period">
        <View style={appStyles.wrap}>
          {PERIODS.map(p => <Chip key={p} label={periodPhrase[p]} active={form.period === p} onPress={() => form.setPeriod(p)} />)}
        </View>
      </Labeled>
      <Labeled label="Expires">
        <View style={appStyles.wrap}>
          {DURATIONS.map(d => <Chip key={d} label={`${d} days`} active={form.duration === d} onPress={() => form.setDuration(d)} />)}
        </View>
        <Muted>Until {shortDate(expiryUnix(form.duration))}</Muted>
      </Labeled>
      {dryRun !== undefined ? <Muted>{budgetSentence(dryRun, form.effectiveBudget, form.period)}</Muted> : null}
    </Card>
  );
}

function StocksSection({ form }: { form: MandateForm }) {
  const { width, fontScale } = useWindowDimensions();
  // Page gutter, card padding and card borders; onLayout replaces the estimate after first paint.
  const [gridWidth, setGridWidth] = useState(Math.max(1, width - inset * 2 - 34));
  const columns = stockGridColumns(gridWidth, fontScale);
  const tileWidth = (gridWidth - (columns - 1) * space.sm) / columns;
  const allSelected = form.universe.size === STOCKS.length;
  return (
    <Card style={appStyles.section}>
      <View style={styles.headingRow}>
        <View style={[styles.heading, styles.grow]}>
          <H2 accessibilityRole="header">Stocks</H2>
          <Muted>Only these stocks can be traded.</Muted>
        </View>
        <HeaderLink title={allSelected ? 'Clear' : 'Select all'} accessibilityLabel={allSelected ? 'Clear all stocks' : 'Select all stocks'}
          onPress={allSelected ? form.clearAll : form.selectAll} />
      </View>
      <View style={styles.grid} onLayout={event => setGridWidth(event.nativeEvent.layout.width)}>
        {STOCKS.map(s => <StockTile key={s.symbol} stock={s} width={tileWidth} on={form.universe.has(s.symbol)} onPress={() => form.toggleStock(s.symbol)} />)}
      </View>
      {form.universe.size === 0 ? <Muted accessibilityRole="alert" style={styles.error}>Pick at least one stock.</Muted> : null}
    </Card>
  );
}

function StockTile({ stock, width, on, onPress }: { stock: Stock; width: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={`${stock.name}, ${ticker(stock.symbol)}`} accessibilityState={{ checked: on }} onPress={onPress}
      style={({ pressed }) => [styles.tile, { width }, on && styles.tileOn, pressed && { opacity: 0.8 }]}>
      <Logo symbol={stock.symbol} size={40} />
      <Body numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.tileName, { color: on ? colors.text : colors.muted }]}>
        {stock.name}
      </Body>
      <Caption>{ticker(stock.symbol)}</Caption>
    </Pressable>
  );
}

/** Link-styled action on a card heading's line: 44pt tall, right-aligned, centred on the H2 rather than the caption. */
function HeaderLink({ title, accessibilityLabel, onPress }: { title: string; accessibilityLabel: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={8}
      style={({ pressed }) => [styles.headerLink, pressed && styles.pressed]}>
      <Body style={styles.headerLinkText}>{title}</Body>
    </Pressable>
  );
}

function RulesSection({ form }: { form: MandateForm }) {
  const { maxPositionPct, takeProfitPct, stopLossPct, blurb } = form.preset;
  return (
    <Card style={appStyles.section}>
      <H2 accessibilityRole="header">Rules</H2>
      <View style={appStyles.wrap}>
        {RISKS.map(r => <Chip key={r} label={riskLabel[r]} active={form.risk === r} onPress={() => form.setRisk(r)} />)}
      </View>
      <Muted>{blurb}</Muted>
      <View>
        <DetailRow label="Max per position" value={`${maxPositionPct}% of budget`} />
        <DetailRow label="Take profit / stop loss" value={`+${takeProfitPct}% / −${stopLossPct}%`} />
      </View>
      <Muted>
        {form.control === 'chat' ? 'Used by automatic mandates only.' : 'Checked before every trade.'}
      </Muted>
    </Card>
  );
}

function ControlSection({ form, aiConfigured, onConnect }: { form: MandateForm; aiConfigured: boolean | undefined; onConnect: () => void }) {
  return (
    <Card style={appStyles.section}>
      <H2 accessibilityRole="header">Who starts a trade?</H2>
      <ChoiceRow selected={form.control === 'chat'} title="I confirm in chat" onPress={() => form.setControl('chat')}
        detail="You confirm each trade in chat." />
      <ChoiceRow selected={form.control === 'automatic'} title="Automatic agent" onPress={() => form.setControl('automatic')}
        detail="Trades on its own within these limits. 60-second cancel window." />
      {form.control === 'chat' && aiConfigured === false ? (
        <Banner tone="base" icon="sparkles" text="Chat trades need an AI connection" action={{ label: 'Connect', onPress: onConnect }} />
      ) : null}
    </Card>
  );
}

function InstructionsSection({ form, agent, draft, draftInput, draftIsStale, draftText, onDraftText, creating }: {
  form: MandateForm; agent: AgentInfo | undefined; draft: UseMutationResult<AIDraft, Error, DraftInput>; draftInput: DraftInput;
  draftIsStale: boolean; draftText: string; onDraftText: (text: string) => void; creating: boolean;
}) {
  const canDraft = !!agent?.ai.configured && agent.ai.developmentSettings && form.validBudget && form.tokens.length > 0
    && form.instructions.trim().length >= 3 && !creating;
  return (
    <Card style={appStyles.section}>
      <H2 accessibilityRole="header">Instructions</H2>
      <Field label="Instructions to the agent" trailing={<Caption>{form.instructions.length}/1000</Caption>}>
        <TextInput accessibilityLabel="Instructions to the agent" value={form.instructions} onChangeText={form.setInstructions} multiline maxLength={1000}
          placeholder="Plain English. Budget, stocks and rules above always apply."
          placeholderTextColor={colors.faint} style={[appStyles.input, appStyles.inputMultiline]} />
      </Field>
      <Button title="Draft with AI" variant="ghost" loading={draft.isPending} disabled={!canDraft} onPress={() => draft.mutate(draftInput)} />
      <Muted>{draftHint(agent)}</Muted>
      {draft.isError ? <Banner tone="red" icon="exclamationmark.circle" text={draft.error.message} /> : null}
      {draft.data ? (
        <View style={styles.draft}>
          <Field label="Review AI draft" hint={draft.data.model} trailing={<Caption>{draftText.length}/1000</Caption>}>
            <Muted>{draft.data.summary}</Muted>
            <TextInput accessibilityLabel="Edit AI draft" multiline maxLength={1000} value={draftText} onChangeText={onDraftText}
              style={[appStyles.input, appStyles.inputMultiline]} />
          </Field>
          {draftIsStale ? (
            <Banner tone="amber" icon="arrow.triangle.2.circlepath" text="Your inputs changed. Generate a new draft to use the current limits." />
          ) : null}
          <Button title="Use these instructions" disabled={draftIsStale || draft.isPending || draftText.trim().length < 10 || creating}
            onPress={() => { form.setInstructions(draftText); draft.reset(); }} />
          <Button title="Discard draft" variant="ghost" onPress={() => draft.reset()} />
        </View>
      ) : null}
    </Card>
  );
}

// ---- Footer and review -------------------------------------------------------

function Footer({ form, agent, admission, isPreview, draftPending, creating, signingStep, onReview }: {
  form: MandateForm; agent: UseQueryResult<AgentInfo, Error>; admission: { atLimit: boolean; cooldown: number };
  isPreview: boolean; draftPending: boolean; creating: boolean; signingStep: string; onReview: () => void;
}) {
  const insets = useSafeAreaInsets();
  const summary = [money(form.effectiveBudget, 0) + ' ' + periodPhrase[form.period], stockCount(form.symbols.length), riskLabel[form.risk], `${form.duration}d`]
    .join(' · ');
  const title = agent.isLoading ? 'Contacting agent…' : agent.isError ? 'Agent unavailable' : 'Review mandate';
  const blocked = !agent.data || !form.validBudget || form.tokens.length === 0 || draftPending || isPreview || admission.atLimit || admission.cooldown > 0;
  return (
    <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
      {admission.atLimit ? (
        <Banner tone="amber" icon="exclamationmark.triangle"
          text={`You have ${MAX_ACTIVE_MANDATES} active mandates, the maximum. Revoke one to create another.`} />
      ) : admission.cooldown > 0 ? (
        <Banner tone="amber" icon="clock" text={`Wait ${admission.cooldown}s before creating another mandate.`} />
      ) : null}
      {/* Capped so the sticky footer stays compact at accessibility text sizes; the review sheet repeats it. */}
      <Muted numberOfLines={1} maxFontSizeMultiplier={1.3} style={styles.centered}>{summary}</Muted>
      {signingStep ? <Muted accessibilityLiveRegion="polite" style={styles.centered}>{signingStep}</Muted> : null}
      <Button title={title} onPress={onReview} loading={creating} disabled={blocked} />
      {isPreview ? <Caption maxFontSizeMultiplier={1.4} style={styles.centered}>Connect a real wallet to create a mandate.</Caption> : null}
    </View>
  );
}

function ReviewSheet({ visible, inline, onClose, form, dryRun, spender, signingStep, creating, approved, error, onConfirm }: {
  visible: boolean; onClose: () => void; form: MandateForm; dryRun: boolean | undefined; spender: Address | null | undefined;
  signingStep: string; creating: boolean; approved: number; error: string; onConfirm: () => void; inline?: boolean;
}) {
  const n = form.tokens.length;
  const plan = approvalPlan(form.control, n);
  const total = plan.total;
  const complete = approved === total;
  const amount = money(form.effectiveBudget, 0);
  const phrase = periodPhrase[form.period];
  // Sell allowances have no on-chain cap and cover stock already in the wallet; the review says so in one line.
  const disclosure = form.control === 'chat'
    ? `USDC allowance of ${amount} ${phrase}. Each stock gets an unlimited sell allowance the first time you sell it.`
    : `USDC allowance of ${amount} ${phrase}, plus unlimited sell allowances on ${stockCount(n)}, including stock you already hold.`;
  return (
    <ConfirmSheet inline={inline} visible={visible} onClose={onClose} title="Review mandate" subtitle={modeLabel(dryRun)} secondaryLabel="Back to editing"
      primary={{
        label: error ? (complete ? 'Save mandate' : 'Continue setup') : dryRun ? 'Create simulation mandate' : total === 1 ? 'Approve in Coinbase' : 'Start wallet approvals',
        onPress: onConfirm, loading: creating, disabled: dryRun === undefined,
      }}
      notice={error ? <Banner tone="amber" live text={`${error} ${complete ? 'Tap Save mandate to finish.' : approved ? `${approved} of ${total} approved. Tap Continue setup for the rest.` : 'Tap Continue setup to retry.'}`} />
        : creating && signingStep ? <Banner tone="base" live text={signingStep} /> : undefined}
      footnote={form.control === 'chat' ? 'You confirm every trade in chat.' : 'The agent trades within these limits.'}>
      {approved > 0 && !error ? <Muted>{approved} of {total} approved</Muted> : null}
      <Card>
        <DetailRow label="Budget" value={`${amount} ${phrase}`} />
        <DetailRow label="Expires" value={`${shortDate(expiryUnix(form.duration))} · ${form.duration} days`} />
        <DetailRow label="Stocks">
          <View style={styles.stocksValue}><LogoStack symbols={form.symbols} size={24} /><Body>{stockCount(n)}</Body></View>
        </DetailRow>
        <DetailRow label="Risk" value={riskLabel[form.risk]} />
        <DetailRow label="Control" value={controlLabel[form.control]} />
        <DetailRow label="Mode" value={modeLabel(dryRun)} />
      </Card>
      {dryRun ? (
        <Banner tone="base" icon="checkmark.shield" text="No approval needed. Simulation moves no real funds." />
      ) : (
        <>
          <Banner tone="amber" icon="exclamationmark.triangle" text={disclosure} />
          <Muted>{plan.summary}</Muted>
          <View style={styles.approvals}>
            <Muted>USDC budget · {amount} {phrase}{approved > 0 ? ' · Approved' : ''}</Muted>
            {form.control === 'chat'
              ? <Muted>Stocks · approved on first sell</Muted>
              : form.symbols.map((s, i) => <Muted key={s}>{s} sell allowance{approved > i + 1 ? ' · Approved' : ''}</Muted>)}
            {spender ? <Muted>Agent account · {shortAddr(spender)}</Muted> : null}
            <Muted>Revoke any time at account.base.app.</Muted>
          </View>
        </>
      )}
    </ConfirmSheet>
  );
}

const styles = StyleSheet.create({
  fill: { paddingHorizontal: 0 },
  content: { paddingHorizontal: inset, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xxl },
  status: { gap: space.md },
  heading: { gap: 2 },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  grow: { flex: 1, minWidth: 0 },
  // The 44pt target overhangs the 24pt heading line so its text sits on the H2 baseline.
  headerLink: { minHeight: 44, justifyContent: 'center', paddingLeft: space.sm, marginVertical: -10 },
  headerLinkText: { color: colors.link, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  labeled: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    minHeight: 96, paddingVertical: 12, paddingHorizontal: 6, gap: 4, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
  },
  tileOn: { borderColor: colors.base, backgroundColor: colors.baseSoft },
  tileName: { fontSize: 12, lineHeight: 16, fontWeight: '600', textAlign: 'center', alignSelf: 'stretch' },
  error: { color: colors.amber },
  draft: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.lg, gap: space.md },
  footer: {
    paddingHorizontal: inset, paddingTop: 10, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  centered: { textAlign: 'center' },
  stocksValue: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  approvals: { gap: space.xs },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
});
