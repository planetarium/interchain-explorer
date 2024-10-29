export class EventDictionary {
  private static readonly events = {
    // ERC-20 Basic Events
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',
    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'Approval',

    // DEX Events
    '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'Swap',
    '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f': 'Mint',
    '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496': 'Burn',

    // Lending Events
    '0x13ed6866d4e1ee6da46f845c46d7e54120883d75c5ea9a2dacc1c4ca8984ab80': 'Borrow',
    '0x1a2a22cb034d26d1854bdc6666a5b91fe25efbbb5dcad3b0355478d6f5c362a1': 'Repay',
    '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c': 'Deposit',
    '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7': 'Withdraw'
  };

  public static getName(signature: string): string {
    return this.events[signature] || `Unknown Event (${signature})`;
  }
}