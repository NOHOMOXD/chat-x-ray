const CHAT_HEADER_SELECTORS = [
  '.stream-chat-header',
  '.chat-room__header',
  '[data-test-selector="chat-room-header"]',
];
export function findHeaderHost() {
  for (const selector of CHAT_HEADER_SELECTORS) {
    const node = document.querySelector(selector);
    if (node && node.isConnected) {
      return node;
    }
  }
  return null;
}

