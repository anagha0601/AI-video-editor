// Timeline JSON: the single source of truth for the in-browser preview AND the
// ffmpeg render in the Python worker (worker/timeline.py mirrors the derived
// helpers). All times are seconds on the timeline unless the field says "source".
// All pixel values are in the design resolution (timeline.width x timeline.height);
// renders at other sizes scale everything uniformly. Keep this file and
// worker/timeline.py in sync; README "Timeline JSON schema" documents it.

export type Aspect = "9:16" | "16:9" | "1:1";

export const DESIGN_SIZE: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
};

export type TransitionType = "cut" | "crossfade" | "slide" | "zoom";
export type FilterPreset = "none" | "warm" | "cool" | "bw";
export type KenBurnsDirection = "in" | "out" | "left" | "right" | "up" | "down";
export type FontId = "inter" | "montserrat" | "bebas" | "playfair" | "marker";
export type TextAnimIn = "none" | "fade" | "slide-up" | "pop";
export type TextAnimOut = "none" | "fade" | "slide-down" | "pop";
export type CaptionStyle = "bold" | "karaoke" | "minimal" | "boxed";

export interface Filters {
  brightness: number; // multiplier, 1 = unchanged (0.5..1.5)
  contrast: number; // multiplier, 1 = unchanged (0.5..1.5)
  saturation: number; // multiplier, 1 = unchanged (0..2)
  preset: FilterPreset;
}

export interface Transform {
  fit: "cover" | "contain"; // how the source is sized into the frame before scale
  scale: number; // extra zoom on top of fit, 1 = none
  x: number; // center offset as a fraction of frame width (-1..1)
  y: number; // center offset as a fraction of frame height (-1..1)
}

export interface Transition {
  type: TransitionType;
  duration: number; // seconds; the previous clip holds its last frame while this clip animates in
}

export interface KenBurns {
  direction: KenBurnsDirection;
  amount: number; // extra zoom at the strongest point, e.g. 0.15
}

interface ClipBase {
  id: string;
  start: number; // timeline seconds
  duration: number; // timeline seconds
}

export interface VisualClip extends ClipBase {
  type: "video" | "image" | "color";
  assetId?: string | null;
  src?: string | null; // playable URL (relative "/..." URLs are served by the web app)
  thumb?: string | null;
  name: string;
  in: number; // source seconds (video only)
  speed: number; // 0.5..2 (video only)
  srcDuration?: number | null; // full length of the source video
  srcWidth?: number | null;
  srcHeight?: number | null;
  hasAudio?: boolean;
  volume: number; // 0..2 (video only)
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transition?: Transition | null; // how this clip enters from the previous adjacent clip
  transform: Transform;
  filters: Filters;
  kenBurns?: KenBurns | null; // images only
  colors?: [string, string] | null; // "color" clips: diagonal gradient
  keywords?: string[]; // what the visual shows (used by AI edits)
  scene?: number | null; // 1-based scene number from the first cut
}

export interface VolumeKeyframe {
  t: number; // seconds from the clip start
  gain: number; // 0..2
}

export interface AudioClip extends ClipBase {
  type: "audio";
  assetId?: string | null;
  src: string;
  name: string;
  in: number; // source seconds
  speed: number; // 0.5..2
  srcDuration?: number | null;
  volume: number; // 0..2
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  duck?: boolean; // music: lower under the voice
  keyframes?: VolumeKeyframe[]; // music: volume automation (multiplies volume)
}

export interface TextStyle {
  font: FontId;
  size: number; // px in design resolution
  color: string;
  background?: string | null; // box behind the text (e.g. lower thirds)
  outline: number; // px
  outlineColor: string;
  shadow: number; // px offset
  uppercase: boolean;
  x: number; // center, fraction of frame width (0..1)
  y: number; // center, fraction of frame height (0..1)
}

export interface TextClip extends ClipBase {
  type: "text";
  text: string; // "\n" for line breaks
  preset?: "title" | "lower-third" | "headline" | "custom";
  style: TextStyle;
  animIn: TextAnimIn;
  animOut: TextAnimOut;
}

export type TrackKind = "video" | "voice" | "music" | "text" | "captions";

interface TrackBase {
  id: string;
  name: string;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
}
export interface VideoTrack extends TrackBase {
  kind: "video";
  clips: VisualClip[];
}
export interface VoiceTrack extends TrackBase {
  kind: "voice";
  clips: AudioClip[];
}
export interface MusicTrack extends TrackBase {
  kind: "music";
  clips: AudioClip[];
}
export interface TextTrack extends TrackBase {
  kind: "text";
  clips: TextClip[];
}
// Captions are derived from the voice clips + transcripts, so they follow every trim.
export interface CaptionsTrack extends TrackBase {
  kind: "captions";
  clips: [];
}
export type Track = VideoTrack | VoiceTrack | MusicTrack | TextTrack | CaptionsTrack;
export type AnyClip = VisualClip | AudioClip | TextClip;

export interface Word {
  id: string;
  text: string;
  start: number; // source seconds in the voice asset
  end: number;
}

export interface CaptionSettings {
  enabled: boolean;
  style: CaptionStyle;
  y: number; // center, fraction of frame height
  size: number; // px in design resolution
  maxWords: number; // per caption line
  edits: Record<string, string>; // word id -> replacement text ("" hides the word)
}

export interface Timeline {
  version: 1;
  aspect: Aspect;
  width: number;
  height: number;
  fps: number;
  background: string;
  tracks: Track[]; // listed top -> bottom as in the editor; upper video tracks draw on top
  transcripts: Record<string, { words: Word[] }>; // voice asset id -> transcript
  captions: CaptionSettings;
  duckLevel: number; // music gain while the voice speaks (0..1)
}
