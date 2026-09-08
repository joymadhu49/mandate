import React from 'react';
import { Page, PreviewBanner } from '@/components/app-ui';
import { AIStatusPanel } from '@/components/ai-panel';

export default function AISettings() {
  return (
    <Page nested title="AI settings" subtitle="Your agent’s connection and current model.">
      <PreviewBanner />
      <AIStatusPanel />
    </Page>
  );
}
