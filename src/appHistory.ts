// @ts-ignore
import { fakeRandomId } from "./helpers.ts";

export class AppHistory {
  constructor() {
    this.current = new AppHistoryEntry({ url: "TODO FIX DEFAULT URL" });
    this.current.__updateEntry(undefined, 0);
    this.entries = [this.current];
    this.canGoBack = false;
    this.canGoForward = false;
  }

  current: AppHistoryEntry;
  entries: AppHistoryEntry[];
  canGoBack: boolean;
  canGoForward: boolean;
  private eventListeners: AppHistoryEventListeners = {
    navigate: [],
    currentchange: [],
    navigatesuccess: [],
    navigateerror: [],
  };

  private getOptionsFromParams(
    param1?: UpdatePushParam1Types,
    param2?: AppHistoryPushOrUpdateOptions
  ): AppHistoryPushOrUpdateFullOptions | undefined {
    let options: AppHistoryPushOrUpdateFullOptions | undefined;
    switch (typeof param1) {
      case "string": {
        if (param2 && typeof param2 === "object") {
          options = param2;
          options.url = param1;
        } else {
          options = { url: param1 };
        }
        break;
      }

      case "object": {
        if (param1) {
          options = param1;
        }
        break;
      }

      // TODO: add case for 'function'
      // waiting on spec clarity to implement though

      default:
        break;
    }

    return options;
  }

  async update(
    callback?: () => AppHistoryPushOrUpdateFullOptions
  ): Promise<undefined>;
  async update(
    fullOptions?: AppHistoryPushOrUpdateFullOptions
  ): Promise<undefined>;
  async update(
    url?: string,
    options?: AppHistoryPushOrUpdateOptions
  ): Promise<undefined>;
  async update(
    param1?: UpdatePushParam1Types,
    param2?: AppHistoryPushOrUpdateOptions
  ) {
    // used in currentchange event
    const startTime = performance.now();

    const options = this.getOptionsFromParams(param1, param2);

    // location.href updates here

    this.current.__updateEntry(options ?? {});
    this.current.finished = false;

    const respondWithPromiseArray = this.sendNavigateEvent(
      this.current,
      options?.navigateInfo
    );

    this.sendCurrentChangeEvent(startTime);

    return Promise.all(respondWithPromiseArray)
      .then(() => {
        this.current.finished = true;
        this.current.__fireEventListenersForEvent("finish");
        this.sendNavigateSuccessEvent();
      })
      .catch((error) => {
        this.current.finished = true;
        this.current.__fireEventListenersForEvent("finish");
        this.sendNavigateErrorEvent(error);
        throw error;
      });
  }

  async push(
    callback?: () => AppHistoryPushOrUpdateFullOptions
  ): Promise<undefined>;
  async push(
    fullOptions?: AppHistoryPushOrUpdateFullOptions
  ): Promise<undefined>;
  async push(
    url?: string,
    options?: AppHistoryPushOrUpdateOptions
  ): Promise<undefined>;
  async push(
    param1?: UpdatePushParam1Types,
    param2?: AppHistoryPushOrUpdateOptions
  ) {
    // used in the currentchange event
    const startTime = performance.now();

    const options = this.getOptionsFromParams(param1, param2);

    const upcomingEntry = new AppHistoryEntry(options, this.current);

    const respondWithPromiseArray = this.sendNavigateEvent(
      upcomingEntry,
      options?.navigateInfo
    );

    this.current.__fireEventListenersForEvent("navigatefrom");
    const oldCurrent = this.current;
    const oldCurrentIndex = this.entries.findIndex(
      (entry) => entry.key === oldCurrent.key
    );

    // location.href updates here.

    this.current = upcomingEntry;
    this.canGoBack = true;
    this.canGoForward = false;

    this.sendCurrentChangeEvent(startTime);
    this.current.__fireEventListenersForEvent("navigateto");

    this.entries.slice(oldCurrentIndex + 1).forEach((disposedEntry) => {
      disposedEntry.__updateEntry(undefined, -1);
      disposedEntry.__fireEventListenersForEvent("dispose");
    });

    this.entries = [
      ...this.entries.slice(0, oldCurrentIndex + 1),
      this.current,
    ].map((entry, entryIndex) => {
      entry.__updateEntry(undefined, entryIndex);
      return entry;
    });

    return Promise.all(respondWithPromiseArray)
      .then(() => {
        upcomingEntry.finished = true;
        upcomingEntry.__fireEventListenersForEvent("finish");
        this.sendNavigateSuccessEvent();
      })
      .catch((error) => {
        upcomingEntry.finished = true;
        upcomingEntry.__fireEventListenersForEvent("finish");
        this.sendNavigateErrorEvent(error);
        throw error;
      });
  }

  private onEventListeners: Record<
    keyof AppHistoryEventListeners,
    AppHistoryEventListenerCallback | null
  > = {
    navigate: null,
    currentchange: null,
    navigatesuccess: null,
    navigateerror: null,
  };

  onnavigate(callback: AppHistoryEventListenerCallback): void {
    this.addOnEventListener("navigate", callback);
  }

  oncurrentchange(callback: AppHistoryEventListenerCallback): void {
    this.addOnEventListener("currentchange", callback);
  }

  onnavigatesuccess(callback: AppHistoryEventListenerCallback): void {
    this.addOnEventListener("navigatesuccess", callback);
  }

  onnavigateerror(callback: AppHistoryEventListenerCallback): void {
    this.addOnEventListener("navigateerror", callback);
  }

  private addOnEventListener(
    eventName: keyof AppHistoryEventListeners,
    callback: AppHistoryEventListenerCallback
  ) {
    if (this.onEventListeners[eventName]) {
      this.eventListeners[eventName] = this.eventListeners[eventName].filter(
        (existingCallback) =>
          existingCallback !== this.onEventListeners[eventName]
      );
    }
    this.onEventListeners[eventName] = callback;
    this.addEventListener(eventName, callback);
  }

  addEventListener(
    eventName: keyof AppHistoryEventListeners,
    callback: AppHistoryEventListenerCallback
  ): void {
    if (
      eventName === "navigate" ||
      eventName === "currentchange" ||
      eventName === "navigatesuccess" ||
      eventName === "navigateerror"
    ) {
      if (!this.eventListeners[eventName].includes(callback)) {
        this.eventListeners[eventName].push(callback);
      }
      return;
    }
    // add other event listeners later
    throw new Error("appHistory does not listen for that event at this time");
  }

  async navigateTo(
    key: AppHistoryEntryKey,
    navigationOptions?: AppHistoryNavigationOptions
  ): Promise<undefined> {
    const entryIndex = this.entries.findIndex((entry) => entry.key === key);
    if (entryIndex === -1) {
      throw new DOMException("InvalidStateError");
    }
    const navigatedEntry = this.entries[entryIndex];

    await this.changeCurrentEntry(navigatedEntry, navigationOptions);
    return;
  }

  async back(
    navigationOptions?: AppHistoryNavigationOptions
  ): Promise<undefined> {
    const entryIndex = this.entries.findIndex(
      (entry) => entry.key === this.current.key
    );
    if (entryIndex === 0) {
      // cannot go back if we're at the first entry
      throw new DOMException("InvalidStateError");
    }

    const backEntry = this.entries[entryIndex - 1];
    await this.changeCurrentEntry(backEntry, navigationOptions);
    return;
  }

  async forward(
    navigationOptions?: AppHistoryNavigationOptions
  ): Promise<undefined> {
    const entryIndex = this.entries.findIndex(
      (entry) => entry.key === this.current.key
    );
    if (entryIndex === this.entries.length - 1) {
      // cannot go forward if we're at the last entry
      throw new DOMException("InvalidStateError");
    }

    const forwardEntry = this.entries[entryIndex + 1];
    await this.changeCurrentEntry(forwardEntry, navigationOptions);
    return;
  }

  private async changeCurrentEntry(
    newCurrent: AppHistoryEntry,
    navigationOptions?: AppHistoryNavigationOptions
  ) {
    await this.sendNavigateEvent(newCurrent, navigationOptions?.navigateInfo);
    this.current.__fireEventListenersForEvent("navigatefrom");
    this.current = newCurrent;
    this.current.__fireEventListenersForEvent("navigateto");

    this.canGoBack = this.current.index > 0;
    this.canGoForward = this.current.index < this.entries.length - 1;
  }

  private sendNavigateEvent(
    destinationEntry: AppHistoryEntry,
    info?: any
  ): Array<Promise<undefined>> {
    const respondWithResponses: Array<Promise<undefined>> = [];

    const navigateEvent = new AppHistoryNavigateEvent({
      cancelable: true,
      detail: {
        userInitiated: true,
        sameOrigin: true,
        hashChange: true,
        destination: destinationEntry,
        info,
        respondWith: (respondWithPromise: Promise<undefined>): void => {
          respondWithResponses.push(respondWithPromise);
        },
      },
    });

    this.eventListeners.navigate.forEach((listener) => {
      try {
        listener.call(this, navigateEvent);
      } catch (error) {}
    });

    if (navigateEvent.defaultPrevented) {
      // if any handler called event.preventDefault()
      throw new DOMException("AbortError");
    }

    return respondWithResponses;
  }

  private sendCurrentChangeEvent(startTime: DOMHighResTimeStamp): void {
    this.eventListeners.currentchange.forEach((listener) => {
      try {
        listener.call(
          this,
          new AppHistoryCurrentChangeEvent({ detail: { startTime } })
        );
      } catch (error) {}
    });
  }

  private sendNavigateSuccessEvent() {
    this.eventListeners.navigatesuccess.forEach((listener) => {
      try {
        listener(new CustomEvent("TODO figure out the correct event"));
      } catch (error) {}
    });
  }

  private sendNavigateErrorEvent(error: Error) {
    this.eventListeners.navigateerror.forEach((listener) => {
      try {
        listener(
          new CustomEvent("TODO figure out the correct event", {
            detail: { error },
          })
        );
      } catch (error) {}
    });
  }
}

class AppHistoryEntry {
  constructor(
    options?: AppHistoryPushOrUpdateFullOptions,
    previousEntry?: AppHistoryEntry
  ) {
    this._state = null;
    if (options?.state) {
      this._state = options.state;
    }
    this.key = fakeRandomId();
    this.url = options?.url ?? previousEntry?.url ?? "";
    this.sameDocument = true;
    this.index = -1;
    this.finished = false;
  }

  key: AppHistoryEntryKey;
  url: string;
  sameDocument: boolean;
  index: number;
  private _state: any | null;
  finished: boolean;

  private eventListeners: AppHistoryEntryEventListeners = {
    navigateto: [],
    navigatefrom: [],
    dispose: [],
    finish: [],
  };

  /** Provides a JSON.parse(JSON.stringify()) copy of the Entry's state.  */
  getState(): any | null {
    return JSON.parse(JSON.stringify(this._state));
  }

  addEventListener(
    eventName: keyof AppHistoryEntryEventListeners,
    callback: (event: CustomEvent) => void
  ): void {
    if (!this.eventListeners[eventName].includes(callback)) {
      this.eventListeners[eventName].push(callback);
    }
    return;
  }

  /** DO NOT USE; use appHistory.update() instead */
  __updateEntry(
    options?: AppHistoryPushOrUpdateFullOptions,
    newIndex?: number
  ): void {
    // appHistory.update() calls this function but it is not part of the actual public API for an AppHistoryEntry
    if (options?.state !== undefined) {
      // appHistory.update({state: null}) should allow you to null out the state
      this._state = options.state;
    }
    if (options?.url) {
      this.url = options.url;
    }

    if (typeof newIndex === "number") {
      this.index = newIndex;
    }
  }

  /** DO NOT USE; for internal use only */
  __fireEventListenersForEvent(
    eventName: keyof AppHistoryEntryEventListeners
  ): void {
    const newEvent = new AppHistoryEntryEvent(
      { detail: { target: this } },
      eventName
    );
    this.eventListeners[eventName].map((listener) => {
      try {
        listener(newEvent);
      } catch (error) {}
    });
  }
}

type AppHistoryEventListenerCallback = (event: AppHistoryNavigateEvent) => void;

type AppHistoryEventListeners = {
  navigate: Array<AppHistoryEventListenerCallback>;
  currentchange: Array<(event: CustomEvent) => void>;
  navigatesuccess: Array<(event: CustomEvent) => void>;
  navigateerror: Array<(event: CustomEvent) => void>;
};

type AppHistoryEntryEventListeners = {
  navigateto: Array<(event: CustomEvent) => void>;
  navigatefrom: Array<(event: CustomEvent) => void>;
  dispose: Array<(event: CustomEvent) => void>;
  finish: Array<(event: CustomEvent) => void>;
};

type UpdatePushParam1Types =
  | string
  | (() => AppHistoryPushOrUpdateFullOptions)
  | AppHistoryPushOrUpdateFullOptions;

export type AppHistoryEntryKey = string;

interface AppHistoryNavigationOptions {
  navigateInfo?: any;
}

interface AppHistoryPushOrUpdateOptions extends AppHistoryNavigationOptions {
  state?: any | null;
}

interface AppHistoryPushOrUpdateFullOptions
  extends AppHistoryPushOrUpdateOptions {
  url?: string;
}

class AppHistoryNavigateEvent extends CustomEvent<{
  readonly userInitiated: boolean;
  readonly sameOrigin: boolean;
  readonly hashChange: boolean;
  readonly destination: AppHistoryEntry;
  readonly formData?: null;
  readonly info: any;
  respondWith: () => Promise<undefined>;
}> {
  constructor(customEventInit: CustomEventInit) {
    super("AppHistoryNavigateEvent", customEventInit);
  }
}

class AppHistoryCurrentChangeEvent extends CustomEvent<{
  startTime: DOMHighResTimeStamp;
}> {
  constructor(customEventInit: CustomEventInit) {
    super("AppHistoryCurrentChangeEvent", customEventInit);
  }
}

class AppHistoryEntryEvent extends CustomEvent<{ target: AppHistoryEntry }> {
  constructor(
    customEventInit: CustomEventInit,
    eventName: keyof AppHistoryEntryEventListeners
  ) {
    super(eventName, customEventInit);
  }
}
