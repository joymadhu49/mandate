import React, { useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { LogOut, CircleAlert, X } from 'lucide-react';
import { useAppDialogs, dismissAppDialog } from '@/lib/browser-dialogs.web';
import { colors } from '@/lib/theme';

/** HTML dialog supplies keyboard focus trapping and Escape without browser alerts. */
export function AppDialogHost({ frame }: { frame: { width: number; height: number } }) {
  const dialog = useAppDialogs(state => state.queue[0]);
  const ref = useRef<HTMLDialogElement>(null);
  const { height } = useWindowDimensions();
  useEffect(() => {
    if (dialog && !ref.current?.open) ref.current?.showModal();
    if (!dialog && ref.current?.open) ref.current.close();
  }, [dialog?.id]);
  if (!dialog) return null;
  const cancel = dialog.buttons.find(button => button.style === 'cancel');
  const actions = [...dialog.buttons.filter(button => button.style !== 'cancel'), ...(cancel ? [cancel] : [])];
  const signOut = dialog.title === 'Sign out of Mandate?';
  const dismiss = () => dismissAppDialog(dialog.id, cancel);
  return <>
    <style>{`
      .mandate-dialog::backdrop { background: rgba(0, 0, 0, .58); }
      .mandate-dialog button { font: inherit; cursor: pointer; }
      .mandate-dialog button:focus-visible { outline: 2px solid ${colors.link}; outline-offset: 3px; }
      .mandate-dialog button:hover { filter: brightness(1.15); }
      @media (prefers-reduced-motion: no-preference) {
        .mandate-dialog[open] { animation: mandate-dialog-enter 160ms ease-out; }
        @keyframes mandate-dialog-enter { from { opacity: 0; transform: translate(-50%, 12px); } to { opacity: 1; transform: translate(-50%, 0); } }
      }
    `}</style>
    <dialog ref={ref} className="mandate-dialog" aria-labelledby="mandate-dialog-title" aria-describedby={dialog.message ? 'mandate-dialog-message' : undefined}
      onCancel={event => { event.preventDefault(); dismiss(); }}
      style={{ position: 'fixed', inset: 'auto', left: '50%', bottom: Math.max(12, (height - frame.height) / 2 + 12), transform: 'translateX(-50%)', margin: 0, boxSizing: 'border-box', width: Math.max(0, frame.width - 24), maxWidth: 'calc(100vw - 24px)', maxHeight: frame.height - 24, overflowY: 'auto', background: colors.card, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 24, padding: 24, boxShadow: '0 16px 64px rgba(0,0,0,.45)', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: signOut ? colors.redSoft : colors.cardAlt, display: 'grid', placeItems: 'center' }}>
          {signOut ? <LogOut size={22} color={colors.red} aria-hidden /> : <CircleAlert size={22} color={colors.link} aria-hidden />}
        </div>
        <button aria-label="Close confirmation" onClick={dismiss} style={{ width: 32, height: 32, border: 0, borderRadius: 16, background: colors.cardAlt, color: colors.muted, display: 'grid', placeItems: 'center' }}><X size={17} aria-hidden /></button>
      </div>
      <h2 id="mandate-dialog-title" style={{ fontSize: 23, lineHeight: '29px', fontWeight: 650, letterSpacing: '-.5px', margin: '0 0 10px' }}>{dialog.title}</h2>
      {dialog.message && <p id="mandate-dialog-message" style={{ fontSize: 15, lineHeight: '23px', color: colors.muted, margin: '0 0 24px', whiteSpace: 'pre-line' }}>{dialog.message}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {actions.map((button, index) => <button key={`${dialog.id}-${index}`} autoFocus={button === cancel || (!cancel && index === 0)} onClick={() => dismissAppDialog(dialog.id, button)}
          style={{ border: 0, borderRadius: 14, minHeight: 52, padding: '13px 16px', fontSize: 16, fontWeight: 600, background: button.style === 'destructive' ? colors.dangerBg : button.style === 'cancel' ? colors.cardAlt : colors.base, color: button.style === 'destructive' ? '#FF7777' : colors.text }}>{button.text ?? 'Continue'}</button>)}
      </div>
    </dialog>
  </>;
}
