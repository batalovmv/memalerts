declare module 'tmi.js' {
  export type ChatUserstate = {
    [key: string]: string | undefined;
    username?: string;
    'user-id'?: string;
    'display-name'?: string;
    badges?: string;
    'badges-raw'?: string;
    mod?: string;
    subscriber?: string;
    turbo?: string;
    'room-id'?: string;
  };

  export type ClientEvents = {
    connected: () => void;
    disconnected: (reason: unknown) => void;
    message: (channel: string, tags: ChatUserstate, message: string, self: boolean) => void;
  };

  export type Client = {
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    join: (channel: string) => Promise<void>;
    part: (channel: string) => Promise<void>;
    say: (channel: string, message: string) => Promise<void>;
    on: <K extends keyof ClientEvents>(event: K, handler: ClientEvents[K]) => void;
  };

  export type ClientConstructor = new (options: {
    options?: { debug?: boolean };
    connection?: { secure?: boolean; reconnect?: boolean };
    identity?: { username?: string; password?: string };
    channels?: string[];
  }) => Client;

  const tmi: {
    Client: ClientConstructor;
  };

  export default tmi;
}
