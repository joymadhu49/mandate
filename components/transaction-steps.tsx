// Each on-chain step of an order or mandate: outcome, time, and a Basescan link when the hash is real.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { TransactionStep } from '@/lib/api';
import { openTransaction } from '@/lib/links';
import { usePreferences } from '@/lib/preferences';
import { colors, space } from '@/lib/theme';
import { transactionStepName, transactionStepStatus, transactionUrl, whenLabel } from '@/lib/ui-presentation';
import { Muted } from './ui';
import { Banner, Icon, ListRow, SectionHeader, type IconName } from './app-ui';

const PREPARED_NOTICE = 'A transaction was prepared but its outcome is unknown. Check Base before acting.';

const stepIcon: Record<TransactionStep['status'], { name: IconName; color: string }> = {
  confirmed: { name: 'checkmark.circle.fill', color: colors.green },
  failed: { name: 'xmark.circle.fill', color: colors.red },
  prepared: { name: 'questionmark.circle', color: colors.amber },
};

export function TransactionSteps({ steps }: { steps?: TransactionStep[] }) {
  const hidden = usePreferences(s => s.hideBalances);
  if (!steps?.length) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Transaction steps" />
      {steps.some(step => step.status === 'prepared') ? <Banner tone="amber" icon="exclamationmark.triangle" text={PREPARED_NOTICE} /> : null}
      <View>{steps.map((step, index) => <StepRow key={`${step.hash}-${index}`} step={step} hidden={hidden} first={index === 0} />)}</View>
    </View>
  );
}

function StepRow({ step, hidden, first }: { step: TransactionStep; hidden: boolean; first: boolean }) {
  const name = transactionStepName(step.name, hidden);
  const status = transactionStepStatus(step.status);
  const when = whenLabel(step.updatedAt);
  const linked = !!transactionUrl(step.hash);
  // Unknown statuses from a newer backend read as "unknown outcome", never as a crash.
  const icon = stepIcon[step.status] ?? stepIcon.prepared;
  return (
    <ListRow
      first={first}
      leading={<View style={styles.icon}><Icon name={icon.name} color={icon.color} size={22} /></View>}
      title={name}
      subtitle={`${status} · ${when}`}
      trailing={linked ? undefined : <Muted>Link unavailable</Muted>}
      onPress={linked ? () => openTransaction(step.hash) : undefined}
      accessibilityLabel={`${name}. ${status}. ${when}. ${linked ? 'View on Basescan' : 'Link unavailable'}`}
    />
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  icon: {
    width: 40, height: 40, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
