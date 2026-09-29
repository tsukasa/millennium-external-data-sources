import type { Component, ReactNode } from 'react';
import type { NewsItem } from '../feed';

export interface NativeEventModel {
  GID: string;
  AnnouncementGID: string;
  appid: number;
  type: number;
  clanSteamID: unknown;
  name: Map<number, string>;
  description: Map<number, string>;
  jsondata: NativeEventData;
  postTime: number;
  rtime32_moderator_reviewed: number;
  startTime?: number;
  endTime?: number;
  GetStartTimeAndDateUnixSeconds?(): number;
}

export interface NativeEventData {
  localized_summary: string[];
  localized_capsule_image: string[];
}

export interface NativeEventModelConstructor {
  new(): NativeEventModel;
  GenerateSummaryFromText(text: string): string;
}

export interface NativeActivityEvent {
  rtEventTime: number;
  unUniqueID: string;
  externalNewsItem?: NewsItem;
  GetEvent(): Promise<NativeEventModel>;
  ReloadEvent(): Promise<NativeEventModel>;
  IsEventLoaded(): boolean;
}

export interface NativeActivityEventConstructor {
  new(time: number, clan: unknown, gid: string, posted: number, appId: string): NativeActivityEvent;
}

export interface ObservableEvents extends Array<NativeActivityEvent> {
  replace?(events: NativeActivityEvent[]): void;
}

export interface NativeActivityDay {
  m_rtDayBegin: number;
  dayBegin: number;
  events: NativeActivityEvent[];
  m_rgEvents?: ObservableEvents;
  isValid: boolean;
  undated?: boolean;
  BHasEvents(): boolean;
  AddEvent(event: NativeActivityEvent): void;
  GetLatestEventTime(): number;
  SortEvents?(): void;
}

export interface NativeAppActivity {
  m_mapActivityByDay: Map<number, NativeActivityDay>;
  m_bNoMoreHistoryAvailable: boolean;
  appActivityByDay: NativeActivityDay[];
  lastAddedPartnerEvent: NativeActivityEvent | null;
  BHasEvents(): boolean;
}

export interface QueryDataClient {
  setQueryData(key: unknown[], value: unknown): unknown;
}

export interface NativeActivityProps {
  appid: number;
  event?: NativeActivityEvent;
}

export interface ReactFiber {
  child?: ReactFiber | null;
  return?: ReactFiber | null;
  stateNode?: unknown;
  pendingProps?: Partial<NativeActivityProps>;
  memoizedProps?: Partial<NativeActivityProps>;
}

export interface ActivityComponent extends Component<NativeActivityProps> {
  _reactInternals?: ReactFiber | null;
  render(): ReactNode;
  OnPostStatusClicked?(): unknown;
  LoadMyVoteInformation?(): unknown;
  OnRateUpClicked?(): unknown;
  OnRateDownClicked?(): unknown;
  ShowOptionsContextMenu?(): unknown;
  OnViewThread?(): unknown;
}
