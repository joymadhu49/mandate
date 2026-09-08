// Conversation-first Agent tab: a compact header that names the mandate context, one thread,
// one composer, and a native controls sheet. Every trade is a proposal until the owner
// reviews it in the confirm sheet; nothing here places an order on its own.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { AccountAccess } from '@/components/account-access';
import { Amount, Body, Button, Caption, Card, H1, H2, Logo, Mono, Muted, Screen, Title } from '@/components/ui';
import {
  Banner, BudgetMeter, ChoiceRow, ConfirmSheet, DetailRow, Icon, ListRow, ModeLine, PreviewBanner, Sheet, SkeletonRows, appStyles, useNow, type IconName,
} from '@/components/app-ui';
import { OrderStatus, isOpenOrder } from '@/components/order-ui';
import { api, type ChatMessage, type ChatProposal, type Mandate, type MandateAuthorization, type Order } from '@/lib/api';
import { openFeed } from '@/lib/links';
import { usePreferences } from '@/lib/preferences';
import { permissionFor, permissionTypedData, sellPermission } from '@/lib/spendPermission';
import { stockByToken, type Address } from '@/lib/stocks';
import { colors, inset, money, radius, space, tabBarClearance } from '@/lib/theme';
import {
  chatMandateLabel, countdownLabel, mandateSummary, mandateTitle, modeLabel, periodNoun, privateAccountText, shortDate, whenLabel,
} from '@/lib/ui-presentation';
import { signTypedData, useWallet } from '@/lib/wallet';

type Params = { mandateId?: string; draft?: string; created?: string; nonce?: string };
type ChatRequest = { requestId: string; message: string; mandateId?: string };
type Suggestion = { prompt: string; label?: string };

const TRADE_WORDS = /\b(buy|sell)\b/i;
const STARTS_WITH_TRADE = /^(buy|sell)\b/i;
// Backend messages that mean "this proposal is dead; ask for a new one" rather than "try again".
const STALE_PROPOSAL = /new (sell )?proposal|price changed|position changed/i;
const PICK_MANDATE_NOTICE = 'Choose a mandate to prepare this trade, or keep researching.';
const SUGGESTIONS: Suggestion[] = [
  { prompt: 'Explain Apple and its risks', label: 'Learn about a stock' },
  { prompt: 'Compare Apple and NVIDIA', label: 'Compare two companies' },
  { prompt: 'Buy $10 of Apple', label: 'Prepare a trade to review' },
];
// The composer's footnote and padding supply the rest of the tab-bar clearance.
const COMPOSER_CLEARANCE = tabBarClearance - 22;

// Slash commands: composer shortcuts that never reach the model, so they work without AI configured.
type CommandName = '/new' | '/research' | '/mandate' | '/help';
type Command = { name: CommandName; description: string };
const COMMANDS: Command[] = [
  { name: '/new', description: 'Start a new conversation' },
  { name: '/research', description: 'Research only · no mandate selected' },
  { name: '/mandate', description: 'Choose a mandate' },
  { name: '/help', description: 'What the agent can do' },
];
const COMMAND_HINT = 'Try /new, /research, /mandate or /help.';
const isCommandText = (text: string) => text.trim().startsWith('/');
const matchingCommands = (text: string) => COMMANDS.filter(c => c.name.startsWith(text.trim().toLowerCase()));
/** The command a submitted text names: its exact name or a unique prefix ("/n"). */
function commandFor(text: string) {
  const query = text.trim().toLowerCase();
  const matches = matchingCommands(query);
  return matches.find(c => c.name === query) ?? (matches.length === 1 ? matches[0] : undefined);
}

const ticker = (symbol: string) => symbol.replace(/c$/, '');
const proposalVerb = (p: ChatProposal) => (p.action === 'buy' ? 'Buy' : 'Sell');
const proposalName = (p: ChatProposal) => stockByToken(p.token)?.name ?? ticker(p.symbol);
function proposalAmount(p: ChatProposal, hidden: boolean) {
  if (hidden) return '••••';
  return p.action === 'buy' ? `${money(p.usd ?? 0)} USDC` : `${((p.fraction ?? 0) * 100).toFixed(2)}% of position`;
}
const isSelectable = (m: Mandate) => m.status === 'active' || m.status === 'pending';

export default function AgentPage() {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen style={{ paddingTop: insets.top + 12 }}>
        <AccountAccess><Conversation /></AccountAccess>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Conversation() {
  const router = useRouter();
  const qc = useQueryClient();
  const focused = useIsFocused();
  const params = useLocalSearchParams<Params>();
  const address = useWallet(s => s.address)!;
  const hidden = usePreferences(s => s.hideBalances);
  const lastMandate = usePreferences(s => s.lastMandate[address.toLowerCase()]);
  const setLastMandate = usePreferences(s => s.setLastMandate);
  const { fontScale } = useWindowDimensions();

  const [selected, setSelected] = useState<string>();
  const [message, setMessage] = useState('');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [controlsNotice, setControlsNotice] = useState<string>();
  const [reviewing, setReviewing] = useState<ChatProposal>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmStep, setConfirmStep] = useState('');
  const [showCreated, setShowCreated] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const input = useRef<TextInput>(null);
  const restored = useRef(false);
  // Scroll to the latest message once history arrives and after every send.
  const pinToEnd = useRef(true);
  const request = useRef<ChatRequest | undefined>(undefined);

  const agent = useQuery({ queryKey: ['agent'], queryFn: api.agent, refetchInterval: focused ? 30_000 : false });
  const mandates = useQuery({ queryKey: ['mandates', address], queryFn: () => api.mandates(address), refetchInterval: focused ? 20_000 : false });
  const history = useQuery({ queryKey: ['chat', address], queryFn: api.chatHistory, retry: false });
  const orders = useQuery({
    queryKey: ['orders', address], queryFn: api.orders,
    // A queued order on a visible proposal card is a live countdown; poll faster only then.
    refetchInterval: q => {
      if (!focused) return false;
      const live = history.data?.some(m => m.proposal && q.state.data?.some(o => o.id === m.proposal!.id && isOpenOrder(o)));
      return live ? 5000 : 10_000;
    },
  });
  const authorization = useQuery({
    queryKey: ['authorization', address, selected], queryFn: () => api.authorization(selected!), enabled: !!selected, retry: false,
    refetchInterval: focused ? 30_000 : false,
  });

  const selectable = useMemo(() => (mandates.data ?? []).filter(isSelectable), [mandates.data]);
  const mandateById = useMemo(() => new Map((mandates.data ?? []).map(m => [m.id, m] as const)), [mandates.data]);
  const orderById = useMemo(() => new Map((orders.data ?? []).map(o => [o.id, o] as const)), [orders.data]);
  // The user text that produced each reply, so a stale proposal can be asked again verbatim.
  const originals = useMemo(() => new Map((history.data ?? []).filter(m => m.role === 'user').map(m => [m.requestId, m.text] as const)), [history.data]);
  const mandate = selected ? mandateById.get(selected) : undefined;
  const configured = !!agent.data?.ai.configured;
  const unconfigured = !!agent.data && !configured;
  const authorized = !!authorization.data?.ready && !authorization.isError;

  const select = useCallback((id: string | undefined) => { setSelected(id); void setLastMandate(address, id); }, [address, setLastMandate]);

  // The same mandate re-applies whenever the caller sends a fresh nonce.
  useEffect(() => {
    if (typeof params.mandateId !== 'string' || !params.mandateId) return;
    restored.current = true;
    select(params.mandateId);
  }, [params.mandateId, params.nonce]);
  useEffect(() => {
    if (typeof params.draft !== 'string' || !params.draft) return;
    setMessage(params.draft);
    const t = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [params.draft, params.nonce]);
  useEffect(() => { if (params.created === '1') setShowCreated(true); }, [params.created, params.nonce]);
  // Restore the last choice once mandates load; otherwise the only chat mandate, else research.
  useEffect(() => {
    if (restored.current || !mandates.data) return;
    restored.current = true;
    if (lastMandate && selectable.some(m => m.id === lastMandate)) { setSelected(lastMandate); return; }
    const chat = selectable.filter(m => m.status === 'active' && m.control === 'chat');
    select(chat.length === 1 ? chat[0].id : undefined);
  }, [mandates.data]);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardWillShow', () => setKeyboardVisible(true));
    const b = Keyboard.addListener('keyboardWillHide', () => setKeyboardVisible(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  const send = useMutation({
    mutationFn: api.chat,
    onSuccess: async () => {
      setMessage(''); request.current = undefined; pinToEnd.current = true;
      await qc.invalidateQueries({ queryKey: ['chat', address] });
    },
  });
  const confirm = useMutation({
    mutationFn: async (p: ChatProposal) => {
      // A chat mandate signs each stock's sell permission the first time that stock is sold. The backend registers it on
      // Base before the order is queued; a token already covered (checked against fresh data) never prompts again.
      if (p.action === 'sell' && !p.dryRun) {
        const current = (await api.mandates(address)).find(m => m.id === p.mandateId);
        if (current && !permissionFor(current.batch, p.token)) {
          const name = stockByToken(p.token)?.name ?? p.symbol;
          setConfirmStep(`Approve selling ${name} in Coinbase…`);
          const permission = sellPermission(current.batch, p.token as Address);
          const signature = await signTypedData(address, permissionTypedData(current.batch, permission));
          setConfirmStep('Registering on Base…');
          await api.addSellPermission(current.id, { ...permission, signature });
          qc.invalidateQueries({ queryKey: ['mandates'] });
        }
      }
      setConfirmStep('Placing your order…');
      return api.confirmChatTrade(p.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['activity'] });
      setReviewOpen(false);
    },
    // The status strip above the composer explains the failure and offers the recovery.
    onError: () => setReviewOpen(false),
    onSettled: () => setConfirmStep(''),
  });
  const clear = useMutation({
    mutationFn: api.clearChat,
    onSuccess: async () => {
      // A fresh thread has no failed request to retry and nothing to pin to.
      send.reset(); confirm.reset(); request.current = undefined; pinToEnd.current = true;
      await qc.invalidateQueries({ queryKey: ['chat', address] });
    },
  });

  const canChat = configured && !agent.isError && !hidden && !history.isError;
  // Commands bypass the model, so the send button works for them even before AI is connected.
  const canSend = !!message.trim() && !hidden && (canChat || isCommandText(message)) && !send.isPending;
  const palette = !hidden && isCommandText(message);

  function sendText(text: string, mandateId = selected) {
    if (!canChat || send.isPending) return;
    // Same text and mandate reuse the request id, so a retry can never double-post.
    if (!request.current || request.current.message !== text || request.current.mandateId !== mandateId) {
      request.current = { requestId: randomUUID(), message: text, mandateId };
    }
    pinToEnd.current = true;
    Keyboard.dismiss();
    send.mutate(request.current);
  }
  const sendRef = useRef(sendText);
  sendRef.current = sendText;

  function submit() {
    const text = message.trim();
    if (!text || send.isPending) return;
    // A slash never reaches the model: run the command it names, or leave the palette's guidance on screen.
    if (isCommandText(text)) { const command = commandFor(text); if (command) runCommand(command); return; }
    // A trade needs a mandate; do not spend a model call to be told so.
    if (!selected && TRADE_WORDS.test(text)) { openControls(PICK_MANDATE_NOTICE); return; }
    sendText(text);
  }
  function runCommand(command: Command) {
    setMessage('');
    switch (command.name) {
      case '/new':
        if (send.isPending || clear.isPending) return;
        clear.mutate();
        input.current?.focus();
        return;
      case '/research':
        chooseMandate(undefined);
        input.current?.focus();
        return;
      case '/mandate':
      case '/help':
        openControls();
        return;
    }
  }
  function suggest(prompt: string) {
    setMessage(prompt);
    if (!selected && STARTS_WITH_TRADE.test(prompt)) openControls(PICK_MANDATE_NOTICE); else input.current?.focus();
  }
  function openControls(notice?: string) { Keyboard.dismiss(); setControlsNotice(notice); setControlsOpen(true); }
  function closeControls() { setControlsOpen(false); }
  function chooseMandate(id: string | undefined) {
    select(id);
    // Picked a mandate for an intercepted trade: back to the composer with the text still there.
    if (controlsNotice && id) closeControls();
  }
  function confirmProposal(p: ChatProposal) {
    if (p.expiresAt * 1000 <= Date.now()) { setReviewOpen(false); return; }
    confirm.mutate(p);
  }

  const failure = send.error ?? confirm.error;
  const staleProposal = !!confirm.error && STALE_PROPOSAL.test(confirm.error.message);
  function freshProposal() {
    const reply = history.data?.find(m => m.proposal?.id === confirm.variables?.id);
    const text = reply ? originals.get(reply.requestId) : undefined;
    confirm.reset();
    if (text) sendText(text, reply?.proposal?.mandateId);
  }
  function retryFailure() {
    if (send.error) { const body = request.current; send.reset(); if (body) send.mutate(body); return; }
    const proposal = confirm.variables; confirm.reset(); if (proposal) confirm.mutate(proposal);
  }
  function retryQueries() { agent.refetch(); mandates.refetch(); history.refetch(); orders.refetch(); if (selected) authorization.refetch(); }

  const openReview = useCallback((p: ChatProposal) => { setReviewing(p); setReviewOpen(true); }, []);
  const openOrder = useCallback((id: string) => router.push(`/order/${id}`), [router]);
  const askAgain = useCallback((text: string, mandateId?: string) => sendRef.current(text, mandateId), []);

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    const p = item.proposal;
    return (
      <MessageRow item={item} hidden={hidden}
        mandate={p ? mandateById.get(p.mandateId) : undefined} order={p ? orderById.get(p.id) : undefined} original={originals.get(item.requestId)}
        reviewDisabled={!orders.data || orders.isError || confirm.isPending} modeMismatch={!!p && p.dryRun !== agent.data?.dryRun}
        reviewLoading={confirm.isPending && confirm.variables?.id === p?.id} canResend={canChat && !send.isPending}
        onReview={openReview} onResend={askAgain} onOrder={openOrder} />
    );
  }, [
    hidden, mandateById, orderById, originals, orders.data, orders.isError, confirm.isPending, confirm.variables?.id, agent.data?.dryRun, canChat,
    send.isPending, openReview, askAgain, openOrder,
  ]);

  const context = !selected
    ? { icon: 'magnifyingglass' as IconName, color: colors.link, text: 'Research only' }
    : mandate
      ? {
        icon: (authorized ? 'checkmark.shield' : 'shield') as IconName, color: authorized ? colors.green : colors.amber,
        text: mandateTitle(mandate, hidden, 'short'),
      }
      : { icon: 'shield' as IconName, color: colors.amber, text: 'Mandate unavailable' };
  const placeholder = unconfigured ? 'Connect AI in Settings to chat' : hidden ? 'Chat hidden in Settings' : 'Message the agent…';

  function statusStrip() {
    if (failure) {
      const text = hidden ? 'Request failed. Turn off Hide balances to see details.' : failure.message;
      const action = staleProposal ? { label: 'Get a fresh proposal', onPress: freshProposal } : { label: 'Retry', onPress: retryFailure };
      return <Banner tone="red" icon="exclamationmark.circle" text={text} action={action} />;
    }
    if (clear.error) {
      const text = hidden ? 'Could not start a new conversation. Turn off Hide balances to see details.' : clear.error.message;
      return <Banner tone="red" icon="exclamationmark.circle" text={text} action={{ label: 'Retry', onPress: () => clear.mutate() }} />;
    }
    const outage = agent.error ?? history.error ?? orders.error;
    if (outage) {
      const text = hidden ? 'Could not reach the agent. Turn off Hide balances to see details.' : outage.message;
      return <Banner tone="red" icon="exclamationmark.circle" text={text} action={{ label: 'Retry', onPress: retryQueries }} />;
    }
    if (unconfigured) {
      const action = { label: 'Set up', onPress: () => router.push('/ai-settings') };
      return <Banner tone="base" icon="sparkles" text="Connect AI to start chatting" action={action} />;
    }
    if (hidden) {
      const action = { label: 'Settings', onPress: () => router.navigate('/(tabs)/settings') };
      return <Banner tone="muted" icon="eye.slash" text="Chat is hidden while Hide balances is on." action={action} />;
    }
    return null;
  }

  return (
    <>
      <View style={styles.header}>
        <H1 accessibilityRole="header">Agent</H1>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose mandate and check authorization" accessibilityHint="Opens agent controls"
          accessibilityValue={{ text: context.text }} onPress={() => openControls()} style={({ pressed }) => [styles.contextPill, pressed && styles.pressed]}>
          <Icon name={context.icon} size={16} color={context.color} />
          {fontScale <= 1.3 ? <Body numberOfLines={1} style={styles.contextText}>{context.text}</Body> : null}
          <Icon name="chevron.down" size={11} color={colors.muted} weight="semibold" />
        </Pressable>
      </View>
      <View style={styles.subheader}>
        <ModeLine dryRun={agent.data?.dryRun} />
        <PreviewBanner />
      </View>
      <FlatList ref={list} data={history.data ?? []} keyExtractor={item => item.id} renderItem={renderItem}
        initialNumToRender={8} maxToRenderPerBatch={8} style={styles.thread} contentContainerStyle={styles.threadContent}
        showsVerticalScrollIndicator={false} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled"
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 100 }}
        onContentSizeChange={() => {
          if (!pinToEnd.current || !(history.data?.length || send.isPending)) return;
          pinToEnd.current = false;
          list.current?.scrollToEnd({ animated: false });
        }}
        ListHeaderComponent={showCreated ? <CreatedCard mandate={mandate} hidden={hidden} onSuggest={suggest} onDismiss={() => setShowCreated(false)} /> : null}
        ListEmptyComponent={history.isPending ? <SkeletonRows count={3} leading={false} /> : <EmptyThread onSuggest={suggest} compact={showCreated} />}
        ListFooterComponent={send.isPending ? <PendingSend text={send.variables.message} hidden={hidden} /> : null} />
      <View style={[styles.composerArea, { paddingBottom: keyboardVisible ? space.sm : COMPOSER_CLEARANCE }]}>
        {palette ? <CommandPalette query={message} onRun={runCommand} /> : statusStrip()}
        <View style={styles.composer}>
          <TextInput ref={input} accessibilityLabel="Message the agent" placeholder={placeholder} placeholderTextColor={colors.muted}
            value={hidden ? '' : message} onChangeText={setMessage} editable={!send.isPending && !hidden} multiline maxLength={2000}
            style={styles.input} />
          <Pressable accessibilityRole="button" accessibilityLabel={send.isError ? 'Retry message' : 'Send message'}
            accessibilityState={{ disabled: !canSend, busy: send.isPending }} onPress={submit} disabled={!canSend}
            style={[styles.send, !canSend && styles.sendDisabled]}>
            {send.isPending
              ? <ActivityIndicator color={colors.text} />
              : <Icon name="arrow.up" color={canSend ? colors.text : colors.faint} size={22} weight="semibold" />}
          </Pressable>
        </View>
        <Caption style={styles.center}>AI can be wrong. Review every trade.</Caption>
      </View>
      <ControlsSheet visible={controlsOpen} onClose={closeControls} notice={controlsNotice} dryRun={agent.data?.dryRun}
        selected={selected} mandate={mandate} mandates={mandates} selectable={selectable} hidden={hidden} onChoose={chooseMandate}
        authorization={authorization} model={configured ? agent.data?.ai.model : undefined}
        onCreate={() => { closeControls(); router.push('/new-mandate'); }} onSettings={() => { closeControls(); router.push('/ai-settings'); }} />
      <ReviewSheet proposal={reviewing} visible={reviewOpen} onClose={() => setReviewOpen(false)} hidden={hidden} loading={confirm.isPending}
        step={confirmStep} mandate={reviewing ? mandateById.get(reviewing.mandateId) : undefined} onConfirm={confirmProposal} />
    </>
  );
}

// ---- Thread rows -------------------------------------------------------------

type ProposalActions = {
  mandate?: Mandate; order?: Order; original?: string; reviewDisabled: boolean; modeMismatch: boolean; reviewLoading: boolean; canResend: boolean;
  onReview: (p: ChatProposal) => void; onResend: (text: string, mandateId?: string) => void; onOrder: (id: string) => void;
};

const MessageRow = React.memo(function MessageRow({ item, hidden, ...actions }: { item: ChatMessage; hidden: boolean } & ProposalActions) {
  const user = item.role === 'user';
  return (
    <View style={[styles.message, user && styles.user]}>
      {!user ? <Muted style={styles.agentLabel}>Agent</Muted> : null}
      <Body selectable style={styles.prose}>{hidden ? 'Conversation hidden while Hide balances is on.' : item.text}</Body>
      {!hidden && item.sources?.length ? <Sources sources={item.sources} /> : null}
      {item.proposal ? <TradeProposal p={item.proposal} hidden={hidden} {...actions} /> : null}
    </View>
  );
});

function Sources({ sources }: { sources: NonNullable<ChatMessage['sources']> }) {
  return (
    <View style={styles.sources}>
      <Caption>Price snapshots · not execution quotes</Caption>
      {sources.map(s => (
        <Pressable key={s.symbol} accessibilityRole="link" accessibilityLabel={`Open ${ticker(s.symbol)} Chainlink feed on Basescan`}
          onPress={() => openFeed(s.url)} style={({ pressed }) => [styles.source, pressed && styles.pressed]}>
          <Body style={styles.link}>{ticker(s.symbol)} · {money(s.price)}</Body>
          <Muted>{s.stale ? 'Stale · ' : ''}{whenLabel(s.updatedAt)} · Chainlink</Muted>
        </Pressable>
      ))}
    </View>
  );
}

/** Floating list of the commands the typed prefix could mean. Rows are plain pressables so the keyboard stays with the composer. */
function CommandPalette({ query, onRun }: { query: string; onRun: (command: Command) => void }) {
  const matches = matchingCommands(query);
  return (
    <Card style={styles.palette}>
      {matches.map((c, i) => (
        <Pressable key={c.name} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.description}`} onPress={() => onRun(c)}
          style={({ pressed }) => [styles.command, i > 0 && styles.commandDivider, pressed && styles.pressed]}>
          <Mono style={styles.commandName}>{c.name}</Mono>
          <Muted>{c.description}</Muted>
        </Pressable>
      ))}
      {matches.length === 0 ? <Muted style={styles.commandNote}>No command named {query.trim()}. {COMMAND_HINT}</Muted> : null}
    </Card>
  );
}

function PendingSend({ text, hidden }: { text: string; hidden: boolean }) {
  return (
    <View style={styles.pending}>
      <View style={[styles.message, styles.user]}><Body style={styles.prose}>{hidden ? 'Message hidden' : text}</Body></View>
      <View style={styles.thinking}>
        <ActivityIndicator color={colors.link} />
        <Muted accessibilityLiveRegion="polite">Thinking… No order is being placed.</Muted>
      </View>
    </View>
  );
}

function SuggestionList({ rows, onSuggest, framed = true }: { rows: Suggestion[]; onSuggest: (prompt: string) => void; framed?: boolean }) {
  return (
    <View style={[styles.suggestions, framed && appStyles.group, framed && styles.framed]}>
      {rows.map((s, i) => (
        <ListRow key={s.prompt} first={i === 0} title={s.prompt} subtitle={s.label} onPress={() => onSuggest(s.prompt)} chevron={false}
          accessibilityLabel={s.prompt} accessibilityHint="Fills the message field" trailing={<Icon name="arrow.up.left" size={18} color={colors.link} />} />
      ))}
    </View>
  );
}

function EmptyThread({ onSuggest, compact }: { onSuggest: (prompt: string) => void; compact: boolean }) {
  // The "Mandate ready" card already offers a trade prompt; do not repeat it.
  const rows = compact ? SUGGESTIONS.filter(s => !STARTS_WITH_TRADE.test(s.prompt)) : SUGGESTIONS;
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Icon name="bubble.left.and.text.bubble.right" size={26} color={colors.link} /></View>
      <Title style={styles.center}>What’s your next move?</Title>
      <Muted style={styles.center}>Explore a stock, compare companies, or prepare a trade to review.</Muted>
      <SuggestionList rows={rows} onSuggest={onSuggest} />
    </View>
  );
}

function CreatedCard({ mandate, hidden, onSuggest, onDismiss }: {
  mandate?: Mandate; hidden: boolean; onSuggest: (prompt: string) => void; onDismiss: () => void;
}) {
  const first = mandate ? stockByToken(mandate.universe[0])?.name : undefined;
  return (
    <Card style={styles.created}>
      <View style={styles.createdHeader}>
        <Icon name="checkmark.circle.fill" size={22} color={colors.green} />
        <Body style={styles.createdTitle}>Mandate ready</Body>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} style={styles.dismiss}>
          <Icon name="xmark" size={14} color={colors.text} weight="semibold" />
        </Pressable>
      </View>
      <Muted>{mandate ? `${mandateTitle(mandate, hidden)} · ${mandateSummary(mandate)}` : 'Loading your mandate…'}</Muted>
      <SuggestionList framed={false} rows={[{ prompt: `Buy $10 of ${first ?? 'Apple'}` }, { prompt: 'What can this mandate do?' }]} onSuggest={onSuggest} />
    </Card>
  );
}

// ---- Trade proposal ----------------------------------------------------------

const TradeProposal = React.memo(function TradeProposal({
  p, hidden, mandate, order, original, reviewDisabled, modeMismatch, reviewLoading, canResend, onReview, onResend, onOrder,
}: { p: ChatProposal; hidden: boolean } & ProposalActions) {
  return (
    <Card style={styles.trade}>
      <View style={styles.tradeHeader}>
        <Logo symbol={p.symbol} size={40} />
        <View style={styles.tradeTitle}>
          <H2>{proposalVerb(p)} {proposalName(p)}</H2>
          <Muted>{ticker(p.symbol)} · {modeLabel(p.dryRun)}</Muted>
        </View>
      </View>
      <Muted accessibilityLabel={`Originating mandate: ${p.mandateId}`}>{mandate ? mandateTitle(mandate, hidden) : chatMandateLabel(p.mandateId)}</Muted>
      <Amount size={30} accessibilityLabel={hidden ? 'Amount hidden' : undefined}>{proposalAmount(p, hidden)}</Amount>
      <View style={styles.tradeDetails}>
        <DetailRow label="Estimated shares" value={hidden ? 'Hidden' : p.estimatedShares.toFixed(4)} />
        <DetailRow label="Reference price" value={hidden ? 'Hidden' : money(p.price)} />
        <DetailRow label="Price updated" value={whenLabel(p.priceUpdatedAt)} />
      </View>
      <Muted>{privateAccountText(p.rationale, hidden)}</Muted>
      {order ? (
        <OrderState order={order} hidden={hidden} onOrder={onOrder} />
      ) : (
        <ReviewFooter p={p} hidden={hidden} disabled={reviewDisabled} modeMismatch={modeMismatch} loading={reviewLoading}
          canResend={canResend && !!original} onReview={() => onReview(p)} onResend={() => { if (original) onResend(original, p.mandateId); }} />
      )}
    </Card>
  );
});

function ReviewFooter({ p, hidden, disabled, modeMismatch, loading, canResend, onReview, onResend }: {
  p: ChatProposal; hidden: boolean; disabled: boolean; modeMismatch: boolean; loading: boolean; canResend: boolean; onReview: () => void; onResend: () => void;
}) {
  const now = useNow(1000);
  const expired = p.expiresAt * 1000 <= now;
  const stale = expired || modeMismatch;
  return (
    <View style={styles.tradeActions}>
      <Button title={expired ? 'Proposal expired' : p.dryRun ? 'Review simulation' : 'Review live trade'} disabled={stale || hidden || disabled}
        loading={loading} onPress={onReview} />
      {stale ? (
        <>
          <Muted style={styles.center}>{expired ? 'Proposals expire after five minutes.' : 'The execution mode changed since this proposal was made.'}</Muted>
          <Button title="Ask again" variant="link" size="md" onPress={onResend} disabled={!canResend} />
        </>
      ) : (
        <Muted style={styles.center}>{hidden ? 'Show balances in Settings to review.' : `Expires in ${countdownLabel(p.expiresAt, now)}`}</Muted>
      )}
    </View>
  );
}

function OrderState({ order, hidden, onOrder }: { order: Order; hidden: boolean; onOrder: (id: string) => void }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(order.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['activity'] }); },
    onError: (e: Error) => { qc.invalidateQueries({ queryKey: ['orders'] }); Alert.alert('Order not cancelled', privateAccountText(e.message, hidden)); },
  });
  const confirmCancel = () => Alert.alert('Cancel this order?', `This stops this ${order.action} before execution. Your mandate stays active.`, [
    { text: 'Keep order', style: 'cancel' }, { text: 'Cancel order', style: 'destructive', onPress: () => cancel.mutate() },
  ]);
  const view = <Button title="View order" variant="link" size="md" onPress={() => onOrder(order.id)} />;
  if (order.status === 'queued') {
    return (
      <View style={styles.tradeActions}>
        <QueuedBanner order={order} />
        <Button title="Cancel order" variant="danger" size="md" loading={cancel.isPending} onPress={confirmCancel} />
        {view}
      </View>
    );
  }
  if (order.status === 'executing') return <View style={styles.tradeActions}><Banner tone="amber" icon="clock" live text="Executing…" />{view}</View>;
  return <View style={styles.tradeActions}><View style={styles.badgeRow}><OrderStatus order={order} /></View>{view}</View>;
}

function QueuedBanner({ order }: { order: Order }) {
  const now = useNow(1000);
  const waiting = order.executeAfter * 1000 > now;
  const text = waiting ? `Order placed · executes in ${countdownLabel(order.executeAfter, now)} · cancel before then` : 'Order placed · executing shortly';
  return <Banner tone="amber" icon="clock" live text={text} />;
}

// ---- Confirm sheet -----------------------------------------------------------

/** A live sell of a stock this mandate has not sold before needs the owner's one-time sell permission first. */
function needsSellApproval(p: ChatProposal, mandate?: Mandate) {
  return p.action === 'sell' && !p.dryRun && !!mandate && !permissionFor(mandate.batch, p.token);
}

function ReviewSheet({ proposal: p, visible, onClose, mandate, hidden, loading, step, onConfirm }: {
  proposal?: ChatProposal; visible: boolean; onClose: () => void; mandate?: Mandate; hidden: boolean; loading: boolean; step: string;
  onConfirm: (p: ChatProposal) => void;
}) {
  if (!p) return null;
  const live = !p.dryRun;
  const label = !live ? 'Confirm simulation' : needsSellApproval(p, mandate) ? 'Approve and confirm' : 'Confirm live trade';
  return (
    <ConfirmSheet visible={visible} onClose={onClose} title={live ? 'Confirm live trade?' : 'Confirm simulated trade?'} subtitle={modeLabel(p.dryRun)}
      primary={{ label, onPress: () => onConfirm(p), loading }} secondaryLabel="Keep reviewing"
      notice={loading && step ? <Banner tone="base" live text={step} /> : undefined}
      footnote={`Mandate ID ${p.mandateId}`}>
      <ReviewBody p={p} mandate={mandate} hidden={hidden} />
    </ConfirmSheet>
  );
}

function ReviewBody({ p, mandate, hidden }: { p: ChatProposal; mandate?: Mandate; hidden: boolean }) {
  const now = useNow(1000);
  const expired = p.expiresAt * 1000 <= now;
  const approval = needsSellApproval(p, mandate);
  return (
    <>
      <View style={styles.reviewHero}>
        <Logo symbol={p.symbol} size={48} />
        <Title style={styles.center}>{proposalVerb(p)} {proposalName(p)}</Title>
        <Amount accessibilityLabel={hidden ? 'Amount hidden' : undefined}>{proposalAmount(p, hidden)}</Amount>
      </View>
      <Card style={styles.details}>
        <DetailRow label="Mandate" value={mandate ? mandateTitle(mandate, hidden) : chatMandateLabel(p.mandateId)} />
        <DetailRow label="Reference price" value={hidden ? 'Hidden' : money(p.price)} />
        <DetailRow label="Estimated shares" value={hidden ? 'Hidden' : p.estimatedShares.toFixed(4)} />
        <DetailRow label="Expires in" value={countdownLabel(p.expiresAt, now)} tone={expired ? 'red' : undefined} />
      </Card>
      {p.action === 'buy' && mandate ? (
        <BudgetMeter budget={mandate.budgetUsdc} spent={mandate.spentThisPeriod} period={mandate.period} periodStart={mandate.periodStart}
          hidden={hidden} after={p.usd} />
      ) : null}
      <Muted>{privateAccountText(p.rationale, hidden)}</Muted>
      {expired ? <Banner tone="amber" icon="clock" text="Proposal expired. Ask again for a fresh one." /> : null}
      {approval ? (
        <Banner tone="base" icon="checkmark.shield" text={`Coinbase will ask once to approve selling ${proposalName(p)}. Later sells won’t ask.`} />
      ) : null}
      <Banner tone={p.dryRun ? 'base' : 'amber'} icon={p.dryRun ? 'info.circle' : 'exclamationmark.triangle'}
        text={`${p.dryRun ? 'No real funds.' : 'Real funds.'} Cancel within 60 seconds in Orders.`} />
    </>
  );
}

// ---- Controls sheet ----------------------------------------------------------

function ControlsSheet({
  visible, onClose, notice, dryRun, selected, mandate, mandates, selectable, hidden, onChoose, authorization, model, onCreate, onSettings,
}: {
  visible: boolean; onClose: () => void; notice?: string; dryRun?: boolean; selected?: string; mandate?: Mandate; mandates: UseQueryResult<Mandate[]>;
  selectable: Mandate[]; hidden: boolean; onChoose: (id: string | undefined) => void; authorization: UseQueryResult<MandateAuthorization>; model?: string;
  onCreate: () => void; onSettings: () => void;
}) {
  const ready = !!authorization.data?.ready && !authorization.isError;
  const budgetNote = (m: Mandate) => (hidden ? 'Budget hidden' : `${money(m.spentThisPeriod ?? 0, 0)} spent this ${periodNoun[m.period]}`);
  const authText = authorization.isFetching ? 'Checking permissions…' : authorization.error?.message ?? authorization.data?.detail ?? 'Not checked yet.';
  return (
    <Sheet visible={visible} onClose={onClose} title="Agent controls" subtitle={modeLabel(dryRun)}>
      {notice ? <Banner tone="amber" icon="exclamationmark.triangle" text={notice} /> : null}
      <Card style={styles.section}>
        <H2 accessibilityRole="header">Trading mandate</H2>
        <ChoiceRow selected={!selected} title="Research only" detail="Ask questions without spending permission" onPress={() => onChoose(undefined)} />
        {selectable.map(m => (
          <ChoiceRow key={m.id} selected={m.id === selected} title={mandateTitle(m, hidden)} detail={`${mandateSummary(m)} · ${budgetNote(m)}`}
            onPress={() => onChoose(m.id)} />
        ))}
        {mandates.isPending ? <SkeletonRows count={1} leading={false} /> : null}
        {mandates.isError ? (
          <Banner tone="red" icon="exclamationmark.circle" text={mandates.error.message} action={{ label: 'Retry', onPress: () => mandates.refetch() }} />
        ) : null}
        <Muted>Signing in is not spending approval. Limits come from the mandate.</Muted>
        <Button title="Create a mandate" variant="ghost" onPress={onCreate} />
      </Card>
      {mandate ? (
        <Card style={styles.section}>
          <H2 accessibilityRole="header">Authorization</H2>
          <Banner tone={ready ? 'green' : 'amber'} icon={ready ? 'checkmark.shield' : 'shield'} live text={authText} />
          <Muted>
            Expires {shortDate(mandate.batch.end)} · {mandate.control === 'chat' ? 'You confirm every trade.' : 'May also queue trades on its own.'}
          </Muted>
          {authorization.data ? <Caption>Checked {whenLabel(authorization.data.checkedAt)}</Caption> : null}
          <Button title="Check again" variant="ghost" size="md" onPress={() => authorization.refetch()} loading={authorization.isFetching} />
        </Card>
      ) : null}
      <Card style={styles.section}>
        <H2 accessibilityRole="header">AI model</H2>
        <Body>{model ?? 'No model connected'}</Body>
        <Button title="AI settings" variant="ghost" size="md" onPress={onSettings} />
        <Muted>Messages go to your OpenRouter model. The last 100 are stored on this backend. Never share keys or recovery phrases.</Muted>
      </Card>
      <Card style={styles.section}>
        <H2 accessibilityRole="header">What the agent can do</H2>
        <Body>Explains and compares supported stocks. Prepares trades you review before they enter Orders.</Body>
        <Muted>No live news. Prices may be delayed. Share counts are estimates. Proposals expire in 5 minutes.</Muted>
      </Card>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingBottom: space.sm },
  contextPill: {
    flexShrink: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: radius.pill,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border,
  },
  contextText: { flexShrink: 1, fontWeight: '600', fontSize: 14 },
  pressed: { opacity: 0.8 },
  subheader: { gap: space.md, paddingBottom: space.xs },
  // The list bleeds past the screen gutter so the scroll gesture spans the full width; content stays inset.
  thread: { flex: 1, minHeight: 0, marginHorizontal: -inset },
  threadContent: { paddingHorizontal: inset, paddingTop: space.lg, paddingBottom: space.xl, gap: 24, flexGrow: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md, paddingVertical: 28 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },
  center: { textAlign: 'center' },
  suggestions: { alignSelf: 'stretch', marginTop: space.sm },
  framed: { paddingHorizontal: 16 },
  message: { gap: space.md },
  user: { backgroundColor: colors.cardAlt, borderRadius: 18, padding: 14, marginLeft: 36, alignSelf: 'flex-end' },
  agentLabel: { fontWeight: '600' },
  prose: { fontSize: 17, lineHeight: 25 },
  sources: { gap: space.xs, paddingTop: space.sm },
  source: { minHeight: 48, gap: 3, justifyContent: 'center', paddingVertical: 6 },
  link: { color: colors.link },
  pending: { gap: 18 },
  thinking: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  created: { gap: space.md },
  createdHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  createdTitle: { flex: 1, fontWeight: '600' },
  dismiss: { width: 44, height: 44, marginVertical: -11, marginRight: -11, alignItems: 'center', justifyContent: 'center' },
  trade: { gap: space.lg, marginTop: space.xs },
  tradeHeader: { flexDirection: 'row', gap: space.md, alignItems: 'center' },
  tradeTitle: { flex: 1, gap: 3, minWidth: 0 },
  tradeDetails: {
    paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  tradeActions: { gap: 10 },
  badgeRow: { flexDirection: 'row' },
  composerArea: { flexShrink: 0, paddingTop: 10, gap: space.sm, backgroundColor: colors.bg },
  palette: { paddingVertical: 4 },
  command: { minHeight: 44, justifyContent: 'center', gap: 2, paddingVertical: 8 },
  commandDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  commandName: { fontWeight: '600' },
  commandNote: { paddingVertical: 8 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', padding: 8, gap: 8, backgroundColor: colors.cardAlt, borderRadius: 26,
    borderWidth: 1, borderColor: colors.border,
  },
  input: { color: colors.text, fontSize: 17, minHeight: 44, maxHeight: 130, flex: 1, paddingHorizontal: 10, paddingTop: 11, paddingBottom: 11 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base },
  sendDisabled: { backgroundColor: colors.border },
  section: { gap: space.md },
  reviewHero: { alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  details: { paddingVertical: space.sm },
});
