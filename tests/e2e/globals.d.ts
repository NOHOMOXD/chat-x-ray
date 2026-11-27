export {};

declare global {
  interface Window {
    __fixture: {
      createChatSocket(): WebSocket | null;
      deliver(socket: WebSocket | null, line: string): boolean;
      appendRow(login: string, text: string): boolean;
      mount7TV(): boolean;
      thirdPartyState(): { bttv: boolean; seventv: boolean };
    };
    roomSocket: WebSocket | null;
  }
}
