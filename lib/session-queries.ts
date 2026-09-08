import type { QueryClient } from '@tanstack/react-query';

export function expireSessionQueries(client: QueryClient) {
  // Explicit denied data updates mounted gates immediately without a retry loop.
  client.setQueriesData({ queryKey: ['session'] }, { account: '' });
  void client.invalidateQueries({ queryKey: ['session'], refetchType: 'none' });
}
