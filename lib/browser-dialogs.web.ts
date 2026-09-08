import { create } from 'zustand';
import type { AlertButton } from 'react-native';

type AppDialog = { id: number; title: string; message?: string; buttons: AlertButton[] };
let nextId = 0;
export const useAppDialogs = create<{ queue: AppDialog[] }>(() => ({ queue: [] }));
export function dismissAppDialog(id: number, button?: AlertButton) {
  if (useAppDialogs.getState().queue[0]?.id !== id) return;
  useAppDialogs.setState(state => ({ queue: state.queue.slice(1) }));
  button?.onPress?.();
}
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    const dialog = { id: ++nextId, title, message, buttons: buttons?.length ? buttons : [{ text: 'Got it' }] };
    useAppDialogs.setState(state => ({ queue: [...state.queue, dialog] }));
  },
};
export const Share = {
  async share(content: { message?: string; url?: string; title?: string }) {
    const text = content.message ?? content.url ?? '';
    if (navigator.share) await navigator.share({ text, title: content.title });
    else { await navigator.clipboard.writeText(text); Alert.alert('Address copied', 'The address is ready to paste.'); }
    return { action: 'sharedAction' };
  },
};
