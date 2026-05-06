/**
 * toast-container.tsx — renders active toasts from imperative toast() calls.
 * Mount once in root layout.
 */

'use client';

import {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  useToastState,
} from '@/components/ui/toast';

export function ToastContainer() {
  const toasts = useToastState();

  return (
    <ToastProvider>
      {toasts.map((t) => (
        <Toast key={t.id} variant={t.variant} open>
          {t.title && <ToastTitle>{t.title}</ToastTitle>}
          {t.description && <ToastDescription>{t.description}</ToastDescription>}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
