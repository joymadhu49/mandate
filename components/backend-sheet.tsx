// Settings → "Backend address": where this build talks to its Mandate agent. One TestFlight build ships with a baked-in
// default; the override lets the same build reach a Mac on the LAN or a deployed agent without rebuilding. Sessions are
// scoped to a backend, so saving a new address signs the wallet out and the next private screen asks to verify it again.
import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, DEFAULT_BACKEND_URL, parseBackendAddress, type BackendPing } from '@/lib/api';
import { usePreferences } from '@/lib/preferences';
import { clearSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';
import { modeLabel } from '@/lib/ui-presentation';
import { Button, Muted } from './ui';
import { Banner, Field, Sheet, appStyles } from './app-ui';

type Status = { tone: 'green' | 'red'; text: string };
type TestState = { data?: BackendPing; error: Error | null };
type SaveState = { error: Error | null };

/** What typed text would commit to: blank and the build default both mean "no override". */
const resolveAddress = (text: string) => text.trim().replace(/\/+$/, '') || DEFAULT_BACKEND_URL;

/** Settings row detail: the override as typed, or the build default labelled as such. */
export function backendDetail(override: string | undefined) {
  return override?.trim() || `Default · ${DEFAULT_BACKEND_URL}`;
}

/** One line under the buttons: the most recent thing that happened to this address. */
function statusFor(test: TestState, save: SaveState): Status | undefined {
  if (save.error) return { tone: 'red', text: save.error.message };
  if (test.error) return { tone: 'red', text: test.error.message };
  if (test.data) return { tone: 'green', text: `Connected · ${modeLabel(test.data.dryRun)}` };
}

export function BackendSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const override = usePreferences(s => s.backendUrl);
  const current = override?.trim() || DEFAULT_BACKEND_URL;
  const [text, setText] = useState(current);
  const test = useMutation({ mutationFn: (address: string) => api.ping(address) });
  const save = useMutation({
    mutationFn: async (address: string) => {
      const next = resolveAddress(address) === DEFAULT_BACKEND_URL ? undefined : parseBackendAddress(address);
      await usePreferences.getState().update({ backendUrl: next });
      // The wallet session and every cached query belong to the backend that produced them.
      await clearSession();
      qc.clear();
    },
    onSuccess: onClose,
  });
  // Each opening starts from what is saved, not from an abandoned draft.
  useEffect(() => { if (visible) { setText(current); test.reset(); save.reset(); } }, [visible]);
  const dirty = resolveAddress(text) !== current;
  const busy = test.isPending || save.isPending;
  const status = statusFor(test, save);
  const edit = (value: string) => { setText(value); if (status) { test.reset(); save.reset(); } };
  const footer = (
    <>
      <Button title="Save" onPress={() => save.mutate(text)} loading={save.isPending} disabled={!dirty || test.isPending}
        accessibilityHint="Signs you out of the current backend" />
      {override ? <Button title="Use default" variant="link" onPress={() => edit(DEFAULT_BACKEND_URL)} disabled={busy} /> : null}
    </>
  );
  return (
    <Sheet visible={visible} onClose={onClose} title="Backend address" subtitle="Where this app talks to your Mandate agent" footer={footer}>
      <Field label="Address" hint="HTTPS for the internet. HTTP only for localhost or your private LAN.">
        <TextInput accessibilityLabel="Backend address" value={text} onChangeText={edit} placeholder={DEFAULT_BACKEND_URL}
          placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" textContentType="URL"
          returnKeyType="done" onSubmitEditing={() => test.mutate(resolveAddress(text))} editable={!save.isPending} style={appStyles.input} />
      </Field>
      <View style={styles.check}>
        <Button title="Test connection" variant="ghost" size="md" onPress={() => test.mutate(resolveAddress(text))} loading={test.isPending}
          disabled={save.isPending} />
        {status ? <Banner tone={status.tone} icon={status.tone === 'green' ? 'checkmark.circle' : 'wifi.exclamationmark'} text={status.text} live /> : null}
      </View>
      <Muted>Changing the address signs you out. Verify your wallet again on the new backend.</Muted>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  check: { gap: space.md },
});
