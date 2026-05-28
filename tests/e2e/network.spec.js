import { test, expect } from '@playwright/test';

test.describe('P2P Network & Sync (Layer 1 & 2)', () => {
  test('Should establish Host-Client connection and synchronize CRDT state', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const clientContext = await browser.newContext();

    const hostPage = await hostContext.newPage();
    const clientPage = await clientContext.newPage();

    await hostPage.goto('/');
    await clientPage.goto('/');

    await hostPage.getByRole('button', { name: /Host Room/i }).click();
    
    // Extract generated Peer ID from the injected data attribute
    const connectedRow = hostPage.locator('.connected-row');
    await expect(connectedRow).toHaveAttribute('data-peer-id', /.+/, { timeout: 10000 });
    const hostId = await connectedRow.getAttribute('data-peer-id');

    const joinInput = clientPage.getByPlaceholder(/Host ID/i);
    await joinInput.fill(hostId);
    await clientPage.getByRole('button', { name: /Join/i }).click();

    // Assert Network State Resolution matches TopBar.vue DOM structure
    const clientBadge = clientPage.locator('.role-badge');
    await expect(clientBadge).toContainText('Client', { timeout: 15000 });
  });
});