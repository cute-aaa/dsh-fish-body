/**
 * 设置页英文文案；键集必须与 zh 完全一致，缺键或多键在类型检查期报错。
 */
import type { Key } from './zh.ts';

export const en: Record<Key, string> = {
  nav: 'Pet Config',
  tabLook: 'Appearance',
  petCardTitle: 'Pet',
  avatarLabel: 'Avatar',
  avatarHint:
    'The small image shown next to this pet’s messages in the chat panel. Without an upload it falls back to the plugin logo; an upload takes effect immediately and replaces the previous one — no need to click Save.',
  avatarUpload: 'Upload avatar',
  avatarChange: 'Change',
  avatarUploading: 'Uploading…',
  avatarUploaded: 'Avatar updated',
  globalTitle: 'Global switches',
  globalHint:
    'Shared by every pet (a pet pack may override them in its own kind file). These switches only change local state and are written to the user config on "Save" (never written immediately); system notifications re-read right after saving, no page refresh needed.',
  cornerHint: 'Which screen corner the pet sticks to (per-monitor work area in desktop mode).',
  marginXHint: 'Horizontal distance from the chosen corner (px); any number.',
  marginYHint: 'Vertical distance from the chosen corner (px); any number.',
  // 「/」命令菜单的行标题（图标由 app.ts 补上）。
  'cmd.chat': 'Chat',
  'cmd.pet': 'Pet',
  'cmd.balance': 'Balance',
  'shortcut.open': 'Open pet chat',
  'shortcut.chat': 'Open chat bubble',
  'shortcut.hear': 'Voice input',
  'shortcut.capture': 'Screenshot to chat',
  shortcutCardTitle: 'Shortcuts',
  shortcutCardHint: 'Two groups once expanded: pet shortcuts and global shortcuts.',
  shortcutRowChat: 'Open chat',
  shortcutRowHold: 'Hold to talk',
  shortcutRowHear: 'Voice input',
  shortcutRowCapture: 'Screenshot',
  shortcutRowPaste: 'Paste image',
  shortcutRowTodo: 'Todo list',
  shortcutRowSleep: 'Sleep / wake',
  shortcutRowDisplay: 'Display position',
  shortcutRowSidebar: 'Open sidebar chat',
  shortcutGroupPet: 'Pet shortcuts',
  shortcutGroupPetHint:
    'On the web, hovering the pet is enough. In the desktop pet window, click the pet first so it takes keyboard focus.',
  shortcutGroupGlobal: 'Global shortcuts',
  shortcutGroupGlobalHint:
    'Dispatched by DSH in the web app and the desktop window; rebind them in Settings → General → Shortcuts.',
  petsLabel: 'Pets',
  add: 'Add pet',
  remove: 'Remove',
  confirmRemove: 'Delete pet "{id}"?',
  confirmTitle: 'Confirm action',
  cancel: 'Cancel',
  ok: 'Got it',
  atLeastOne: 'Keep at least one pet.',
  emptyPets: 'No pets yet — click "Add pet" to create one.',
  sizeLabel: 'Size (width px)',
  sizeHint: 'Slider and number box write the same value, 120–2048. Height is automatic = width × 9/16.',
  sizesOf: 'Size for {renderer}',
  sizeFollowDefault: 'Follow default',
  sizePercentLabel: 'Max screen width (%)',
  sizePercentHint:
    'How much of the screen width the pet may take: 100 = never wider than one screen (identical to px on wide windows); try 30–40 to make it clearly smaller on a phone without changing the desktop. Computed once on page load; refresh after resizing.',
  nameLabel: 'Name',
  nameHint:
    'Shown on hover and added to AI personas ("your name is X"). Duplicates allowed; empty falls back to the pet id.',
  personaLabel: 'Persona (optional)',
  personaHint:
    'Applies to this pet only. Leave empty to follow the entry persona — the grey text inside the box is exactly that. The system prompt actually sent = this text + an appended 「your name is "<name>"」 line + the current time context, so do not repeat the name or the date here.',
  personaCount: '{n} chars',
  balanceEnabled: 'Balance',
  balanceEnabledHint: 'When enabled, this pet plays balance animations and shows the balance bubble.',
  whisperEnabled: 'Whisper',
  whisperEnabledHint:
    'When enabled, this pet periodically generates a line via AI and plays the whisper animation (persona = the field below; empty follows the entry).',
  workStatusEnabled: 'Work status',
  workStatusEnabledHint:
    'When enabled, this pet follows DSH work state: thinking / working / waiting / done / error switch animations and show bubbles (pool in top-level config; listening only, no model calls).',
  fixedEnabled: 'Pin in place',
  fixedEnabledHint:
    'When enabled, the random chain no longer turns this pet or walks it away — only idle and in-place actions play. Right-click picks, API triggers and balance / whisper / work-status animations are unaffected.',
  clickThrough: 'Click-through',
  clickThroughHint:
    'When enabled, the desktop window of this pet ignores the mouse entirely: clicks fall through to the app underneath, so the pet can only be watched. Desktop only — the web overlay stays draggable. Turning it on also makes the right-click menu unreachable, so untick this box here to switch it back off.',
  displayLabel: 'Display',
  displayHint: 'web = browser only / desktop = desktop only / both = both / none = neither',
  'display.web': 'Browser only',
  'display.desktop': 'Desktop only',
  'display.both': 'Both',
  'display.none': 'Neither',
  rendererLabel: 'Renderer',
  rendererHint:
    'webm = video animation / layered = layered PNG (surfcore skins) / live2d = Cubism model. The three asset kinds are mutually exclusive; switching rebuilds the stage immediately.',
  'renderer.webm': 'webm (video)',
  'renderer.layered': 'layered (PNG)',
  'renderer.live2d': 'live2d (Cubism)',
  cornerLabel: 'Position',
  'corner.top-left': 'Top-left',
  'corner.top-right': 'Top-right',
  'corner.bottom-left': 'Bottom-left',
  'corner.bottom-right': 'Bottom-right',
  marginX: 'Horizontal offset',
  marginY: 'Vertical offset',
  saveHotkey: 'Ctrl+S / Cmd+S',
  corruptTitle: 'User config is corrupted — not saved',
  corruptConfirm: 'Save anyway',
  corruptBody:
    'The user config file cannot be parsed (corrupted, not valid JSON/JSONC): {path}. Saving now rebuilds it from the whitelist — everything currently in that file (animations / physics / memes …) will be lost. Cancel = leave the file untouched (fix it and save again); Confirm = save anyway (discard what is in the file).',
  configMeta: 'Advanced (files)',
  configMetaHint:
    'User config may override pets / animation pools / weights — refresh or restart to apply: refresh the page in the browser, or right-click a desktop pet → "Reload config" (rebuilds every desktop pet window). The default config is the complete reference.',
  defaultConfig: 'Default config (read-only, complete reference)',
  userConfig: 'User config (custom overrides)',
  todosFile: 'Todo data (text, due time and done state; deleting it clears every todo)',
  animationDir: 'Animation assets dir (add/customize animations here)',
  memesDir: 'Meme images dir (add/customize images here)',
  poolDir: 'Asset pool dir (shared skins / models / animations / sounds)',
  logFile: 'Log file (for troubleshooting; safe to clear)',
  logFileNote:
    'The DSH desktop app has no console, so every runtime log of the plugin (startup, desktop pet crashes/restarts, errors and warnings) goes into this single file — attach it when reporting a problem. It is capped at 1 MB; once full, only the latest 512 KB is kept.',
  saved: 'Saved — the pets updated instantly.',
  loadError: 'Failed to load config',
  saveError:
    'Failed to save config. Check the server connection, configuration directory write permissions and server log.',
  saveInvalid: 'Failed to save config: invalid configuration. Check the values and try again.',
  loading: 'Loading config…',
  retry: 'Retry',
  invalid: 'Check your input: size must be positive; margins can be any number.',
  extraPetsHint:
    "{n} more kind(s) come from files in the pet/ directory (<name>-config.json + <name>-animation/). Switch to them in the Kinds row above; Save writes back to each pack's own config, never into main-config.jsonc.",
  kindLabel: 'Kinds',
  kindMain: 'Built-in',
  lastOfKind:
    '"{entry}" has only this pet left — deleting it would remove the whole kind. Delete the pet pack files to remove it entirely.',
  savePartial:
    'Main pets saved, but {names} could not be written back: check that the pack config is valid and the directory is writable.',
  notifyToggle: 'System notifications',
  notifyToggleHint:
    'OS-level toasts (bottom-right of the desktop) for conversation completion, failures, permission requests, and questions — only while this window is unfocused.',
  sfxToggle: 'Sound',
  sfxToggleHint:
    'Plays the configured and auto-matched sound files; off mutes everything. You rarely edit config: drop click.wav into a skin folder, pet/<root>-sound/ or next to an animation and it is picked up automatically. Slots without a file fall back to the built-in defaults.',
  sfxKeepAliveToggle: 'Keep audio warm',
  sfxKeepAliveToggleHint:
    'Holds the audio output open with an inaudible 1-LSB source so a long-idle first sound does not lose its attack, and the system mixer keeps an "Electron" entry you can use as a master gain. Costs an always-on device and battery; Windows usually will not auto-sleep while the stream is active.',
  sfxVolumeLabel: 'Sound volume',
  sfxVolumeHint:
    'Multiplied with each cue own volume: 0 mutes sounds only (voice unaffected), 1 is full. The system mixer entry is a second master gain.',
  sfxTitle: 'Event sounds',
  sfxHint:
    'Which file plays for each moment is decided by the host: skin folder > -sound folder > next to the animation > user shared > package defaults. This page only changes switches; loudness is the master sound volume under Global.',
  sfxFileHint:
    'To swap a file, put the audio into a skin folder (pet/xxx-skin/click.wav) or pet/<root>-sound/; the file name is the slot name. Refresh this page afterwards.',
  sfxSlotPattern: 'File name: {name}.wav or <skin>-{name}.wav',
  sfxNone: 'no file',
  sfxTry: 'Preview',
  sfxSlotClick: 'Click',
  sfxSlotThrow: 'Throw',
  sfxSlotFloor: 'Land',
  sfxSlotWall: 'Wall',
  sfxSlotCeiling: 'Ceiling',
  sfxSlotPet: 'Pet bump',
  sfxSlotSleepStart: 'Falling asleep',
  sfxSlotSleepEnd: 'Waking up',
  sfxOriginSkin: 'skin',
  sfxOriginSound: 'sound folder',
  sfxOriginAnimation: 'animation folder',
  sfxOriginUser: 'user shared',
  sfxOriginDefault: 'built-in',
  sfxOriginConfig: 'config override',
  sfxOriginNone: 'unmatched',
  sfxOriginPoolSkin: 'asset pool · resource',
  sfxOriginPoolRenderer: 'asset pool · renderer',
  sfxOriginPoolGlobal: 'asset pool · global',
  sfxWhereToPut: 'Put the file here: {path}',
  sfxHooksTitle: 'Custom hooks',
  sfxHooksHint:
    'Register a name here and trigger it with POST /sfx/<name>?pet=<id>; the file is matched by naming rule, no config editing needed.',
  sfxHookAdd: 'Register',
  sfxHookPlaceholder: 'hook name, e.g. ding',
  sfxHookInvalid: 'Use letters, digits, underscore or hyphen only (1-64 chars)',
  sfxHookExists: 'That name is already registered',
  sfxHookRemove: 'Unregister',
  sfxHookPattern: 'File name: hook-<name>.wav or <skin>-hook-<name>.wav, inside a skin folder or the -sound folder',
  sfxHookEmpty: 'No hooks yet: register a name above, or drop a hook-<name>.wav file into the sound folders.',
  sfxHookCurlHint: 'Example: curl -X POST "http://127.0.0.1:3099/dsh-pet-7340/sfx/ding?pet=main"',
  sfxHookBuiltinTag: 'built-in trigger',
  sfxOpenFolder: 'Open folder',
  sfxOpenFolderFailed: 'Could not open the asset folder: no answer from the host.',
  sfxFolderMissing: 'This folder does not exist yet. Create it?',
  sfxFolderCreateYes: 'Yes',
  sfxFolderCreateNo: 'No',
  sfxFolderDismiss: 'Got it',
  whisperImageToggle: 'Whisper images',
  whisperImageToggleHint:
    'Attach one random meme from the pool to each whisper line (image mapping lives in the top-level `memes` config field). Tokens: a whisper already calls the model every cycle, so the image only appends the name + description of that one meme (~100 chars / ~60 tokens) to the same request — negligible.',
  chatImageToggle: 'Chat images',
  chatImageToggleHint:
    'Let the AI pick one meme from the pool that fits the current context (optional; mapping lives in the top-level `memes` config field). Tokens: every message carries the whole catalog — currently ~1.1k chars (~650 tokens, about 11x the whisper case) and growing with the number of images; turning this off appends nothing at all.',
  chatAnimationToggle: 'Chat actions',
  chatAnimationToggleHint:
    'When on, the chat request carries the list of playable animations (every action under animations.categories): if the model judges that the line really performs one, the pet acts it out on the spot; otherwise it replies in text only. Tokens: every message carries the whole list; off appends nothing. Global default for all pets (a pet pack can override it in its own config file).',
  confineToggle: 'Lock to the current screen',
  confineToggleHint:
    'Multi-monitor: when on, the pet stays inside the screen it is currently on — a thrown pet bounces only inside the screen it was released on (screen seams act as walls, so it never flies to the neighbouring monitor), and autonomous wandering only walks within the screen it is currently on (a step that would cross the seam is simply cancelled). Turn this off to let it cross screens as usual. Desktop only — the browser overlay always stays inside the viewport anyway.',
  trayToggle: 'System tray',
  trayToggleHint:
    'Shows a tray icon (notification area on Windows, menu bar on macOS) once desktop mode is running. It lists every pet in the config and toggles each one between desktop and web/none — including pets that are currently off the desktop and therefore have no window to right-click. With it off, bringing a pet back to the desktop requires opening the browser (the settings page, or right-clicking a web pet there). Windows already folds third-party icons into the "hidden icons" overflow. Desktop mode only.',
  voiceTitle: 'Voice',
  voiceHint:
    'Four switches plus a voice: each kind of speech has its own switch and none of them depends on another. All off by default; written to the user config on "Save" (never written immediately).',
  voicePreview: 'Preview',
  voicePreviewLoading: 'Synthesizing…',
  voicePreviewPlaying: 'Playing',
  voicePreviewFailed: 'Preview failed: the speech service or network is unavailable',

  voiceEnabled: 'Speak manual whispers',
  voiceEnabledHint:
    'Speaks whispers triggered from the context menu or a slash command, plus chat replies. The speaker button in the chat panel speaks a single line whenever you press it. It only affects whether sound is produced — bubbles, chat memory and system notification pop-ups are untouched; a failed synthesis is logged and never interrupts the conversation.',
  voiceWhisperEnabled: 'Speak whispers',
  voiceWhisperEnabledHint:
    'Speaks the periodically generated whisper. Off by default — whispers are background narration and should not make noise unasked.',
  voiceTodoEnabled: 'Speak todo reminders',
  voiceTodoEnabledHint:
    'Speaks a todo reminder when it comes due (the bubble still appears; this only decides whether it is spoken). Off by default.',
  voiceNotifyEnabled: 'Speak work status',
  voiceNotifyEnabledHint:
    'Speaks a configured work-status line when a task completes, fails, or waits for your confirmation. Like system notifications, it only speaks while you are away from this page (switched away, unfocused, minimized) — no interruption while you are looking at the screen. Only the configured line is spoken, never the task detail. Off by default.',
  speakStripEmoji: 'Strip emoji from speech',
  speakStripEmojiHint:
    'Removes emoji (🙂 / ❤️ / 🇨🇳) from the text before synthesis: synthesizers read them out as a word. A line made only of emoji is skipped. On by default; affects spoken text only, never recognition or bubbles.',
  voiceNameLabel: 'Voice',
  voiceLocalLabel: 'Voice (local)',
  voiceLocalHint: 'Timbre of the local voice service; applies from the next sentence',
  voiceProviderTitle: 'Local voice (GSV)',
  voiceProviderHint: 'GPT-SoVITS service URL and asset folders; voices are rescanned right after saving',
  voiceProviderSave: 'Save connection',
  voiceProviderSaved: 'Saved; the voice list has been refreshed',
  voiceProviderReady: 'Service online, voices ready',
  voiceProviderStart: 'Start service',
  voiceProviderStop: 'Stop service',
  voiceProviderStarted: 'Start sent; available in about 40 seconds',
  voiceProviderStopped: 'Stop sent',
  voiceNameFallbackHint:
    'Ignored while the local voice is available: it only picks the edge voice used when GSV is down',
  voiceVolumeLabel: 'Volume',
  voiceVolumeHint:
    'Playback volume as a 0–1 decimal: 1 is full volume (100%), 0 is muted. Changes loudness only and never re-synthesizes audio, so adjusting it costs nothing extra. All four kinds of speech share this one volume.',
  physicsTitle: 'Physics (drag & throw feel)',
  physicsHint:
    'Global default, shared by every pet (a pet pack may override it in its own kind file); written to the user config on "Save" (never written immediately). Applies instantly in the browser; on the desktop it applies once Save reloads the pet windows.',
  mobileTitle: 'Mobile effects',
  mobileHint:
    'Only meaningful in a phone browser: haptics needs a vibration motor, the two motion switches need tilt / accelerometer sensors, and sensors require HTTPS or localhost.',
  'physics.gravity': 'Gravity',
  'physics.gravityHint': 'px/s² — the higher, the faster it falls; 0 = weightless (flies straight forever)',
  'physics.restitution': 'Bounciness',
  'physics.restitutionHint':
    '0–1, speed kept when bouncing off a wall or the floor (1 = perfectly elastic, 0 = stops dead)',
  'physics.groundFriction': 'Contact friction',
  'physics.groundFrictionHint':
    'per second, damping along any surface hit (wall, floor, ceiling); 0 = frictionless ice everywhere',
  'physics.throwPower': 'Throw power',
  'physics.throwPowerHint':
    '> 0, overall multiplier for spring tracking and release speed (1 = default; higher = tighter tracking, harder throws)',
  physicsCeilingBounce: 'Ceiling bounce',
  physicsCeilingBounceHint:
    'Turn this off to let a throw fly out through the top of the screen (gravity still pulls it back)',
  physicsPetCollision: 'Pet collisions',
  physicsPetCollisionHint: 'A flying pet bounces off the others with momentum conservation (mass ∝ size²)',
  physicsHaptic: 'Collision haptics',
  physicsHapticHint:
    'One buzz per hit (walls, floor, ceiling, other pets). Works in Chrome/Edge; not on iOS or WebView shells like Via. Do Not Disturb blocks it.',
  physicsTilt: 'Tilt gravity',
  physicsTiltHint:
    'Tilt the phone and gravity follows it (magnitude = the gravity value above); with gravity at 0 tilt has no effect. Requires HTTPS/localhost.',
  physicsShake: 'Shake to throw',
  physicsShakeHint:
    'Shake to fling the pet along the shake direction; strength scales with throwPower. Independent of gravity, so it still works at gravity 0. Requires HTTPS/localhost.',
  invalidPhysics: 'Check the physics values: gravity / ground friction ≥ 0, bounciness 0–1, throw power > 0.',
  fontTitle: 'Appearance & font',
  fontHint:
    'The family applies to every place that currently uses the candy font: pet bubble, hover tooltip, chat popup, score popup. The size applies only to the pet bubble and the hover tooltip (chat and score popups keep their own size). Global default, shared by every pet (a pet pack may override it in its own kind file); written to the user config on "Save" — instant in the browser, and on the desktop it applies once Save reloads the pet windows.',
  fontFamilyLabel: 'Font',
  fontFamilyHint:
    '"Candy (bundled)" ships with the plugin; the others are system fonts. If a font is missing on this machine, it falls back to the next one in the stack (never blank, never an error).',
  fontSizeLabel: 'Font size (px)',
  fontSizeHint:
    'Bubble body text size; the tooltip and the smaller lines inside the bubble scale proportionally. Range 4–200.',
  fontFollowToggle: 'Scale font with pet size',
  fontFollowToggleHint:
    'On (default): the font grows with the pet — at 462 px width it is exactly the size above. Off: the size stays fixed regardless of pet size.',
  invalidFont:
    'Check the font settings: the family must be in the list and the size must be a number between 4 and 200.',
  'font.candy': 'Candy (bundled)',
  'font.yahei': 'Microsoft YaHei / PingFang',
  'font.youyuan': 'YouYuan',
  'font.kaiti': 'KaiTi',
  'font.simsun': 'SimSun',
  'font.comic': 'Comic Sans MS',
  'font.system': 'System default',
  modelTitle: 'Chat & models',
  modelHint:
    'Which model each of whisper and chat uses, and how much history every chat request carries. "Follow current conversation" uses the model your current conversation is on (default). Global default: applies to every pet, and a pet pack may override it in its own kind file. The options come from the same source as the DSH model picker, served live by the host.',
  modelFollow: 'Follow current conversation',
  modelSearch: 'Search models…',
  modelEmpty: 'No matching models.',
  modelNoModels: 'No models available.',
  modelLoading: 'Refreshing model list…',
  modelTriggerAria: 'Select model, current {model}',
  modelUnknown: ' (current config, not in the list)',
  modelNone: 'No models available for this provider',
  whisperModelLabel: 'Whisper model',
  chatModelLabel: 'Chat model',
  modelFieldHint:
    '"Follow current conversation" uses the conversation model; if a chosen model fails, the plugin falls back to the conversation model and retries once.',
  invalidModel:
    'Check the model settings: pick both a provider and a model, or leave both empty (follow the current conversation).',
  modelCatalogFailed:
    'Failed to load the model list (refresh the page to retry); your current values are kept as they are.',
  chatMemory: 'Chat history rounds',
  chatMemoryHint:
    'How many recent rounds each chat request carries (1 round = 1 question + 1 answer; 0 = no history, every message starts fresh). The memory itself keeps everything — this only decides how much goes into the context: higher remembers more and costs more tokens. Global default, shared by every pet (a pet pack may override it in its own kind file).',
  invalidChatMemory: 'Check the chat history rounds: it must be a number ≥ 0.',
  chatImageLimit: 'Chat image limit',
  chatImageLimitHint:
    'How many memes at most are listed to the model during chat ("first N" = the first N you wrote in the config, so move the ones you want sent to the front). That whole list is attached to every message and tokens grow linearly with the count, so a long list is pure burn; capping it to the first N makes the model pick only among those. 0 = no limit (send everything). Built-in default 10. Global default, shared by every pet (a pet pack may override it in its own kind file). Chat only — a whisper carries just the one meme it drew.',
  invalidChatImageLimit: 'Check the chat image limit: it must be a number ≥ 0 (0 = no limit).',
  notifyTest: 'Test notification',
  notifyTestOk: 'Test notification sent — check the bottom-right of your desktop.',
  notifyDenyUnsupported: 'System notifications are not supported in this environment (no Notification API).',
  notifyDenyBlocked: 'Notification permission is blocked by the browser.',
  notifyDenyRejected: 'You chose "Block" in the permission prompt.',
  notifyDenyError: 'Failed to request permission',
  notifyGuide:
    'Guide: click the 🔒/ⓘ icon next to the address bar → Site settings → Notifications → set to "Allow", then refresh and retry.',
  storageTitle: 'Uninstall & storage',
  storageHint:
    'Every location this plugin writes to. Deleting cache folders is harmless (they re-download / rebuild); deleting "plugin user data" loses your config and chat memory.',
  'storage.userData':
    'Plugin user data: custom config main-config.jsonc, chat memory memory.json, custom animation assets main-animation/, file pets pet/',
  'storage.electron':
    'Electron runtime used by the desktop pet (large; re-downloaded automatically the next time desktop mode starts)',
  'storage.desktopCache':
    'Desktop pet window cache and primary-monitor scale cache (safe to delete, rebuilt automatically)',
  'storage.electronCache': 'Electron installer download cache (safe to delete, re-downloaded when needed)',
  'storage.package': 'The plugin itself (managed by DSH — remove it with the command below instead of deleting it)',
  storageMissing: ' (not created yet)',
  uninstallTitle: 'How to uninstall',
  uninstallStep1:
    '1. Quit DSH first (the desktop pet exits with it); do not delete these files while the pet is running.',
  uninstallStep2: '2. Remove the plugin itself (run in a terminal; this also drops it from the profile bundle layer):',
  uninstallStep3:
    '3. Delete the locations above as needed: cache folders are harmless; deleting "plugin user data" loses your config and chat memory (back up main-config.jsonc first if you want to keep it).',
  motionTitle: 'Action frequency',
  motionHint:
    'Four boxes: idle / turn / move are editable, and the random action is computed (100 − the other three). Global default, shared by every pet; a pet pack may override it in its own kind file.',
  'motion.idle': 'Idle',
  'motion.turn': 'Turn',
  'motion.move': 'Move',
  'motion.action': 'Random action',
  uninstallCmd: 'dsh plugin --profile {profile} remove dsh-pet',
  // 会话鱼设置（并入本页后从 pet.sessionFish 命名空间搬来）。
  'fish.intro':
    'Every new, running, or just-finished session gets a small "writing code" animation. Drag it to move, click to open its session, × to dismiss it.',
  'fish.enabled': 'Enable session fish',
  'fish.enabledHint':
    'Turning it off clears the current fish and hides the layer; a session gets a fish again on its next activity after you turn it back on.',
  'fish.size': 'Animation size',
  'fish.sizeHint': 'Display width (px); height follows the skin ratio, clamped to 0.5–2× the width.',
  'fish.skin': 'Skin',
  'fish.skinHint':
    'Built-in animations are ready to use; drop your own image / GIF / webm into the skin folder, then hit Rescan.',
  'fish.skinDefault': 'Default (writing code)',
  'fish.skinDefaultName': 'Default skin',
  'fish.skinBuiltin': 'Built-in',
  'fish.skinMine': 'Mine',
  'fish.skinMissing': '(file missing)',
  'fish.skinRescan': 'Rescan',
  'fish.skinRescanned': 'Scan finished: ',
  'fish.skinRescanFailed': 'Scan failed: skin list unavailable',
  'fish.openSkinFolder': 'Open skin folder',
  'fish.followPet': 'Circle the pet',
  'fish.followPetHint':
    'Turn it off to stack fish in the bottom-right corner again. While on, fish orbit the pet, follow it, and get pushed aside; after a drag they fling and settle back into their own spot.',
  'fish.maxCount': 'Maximum fish',
  'fish.maxCountHint': 'Extra fish are evicted oldest-finished first; running sessions are kept.',
  'fish.bubbleSec': 'Bubble duration',
  'fish.bubbleSecHint': 'Seconds a line stays in the bubble. Finished fish stay until you open their session.',
  'fish.progressGapSec': 'Progress interval',
  'fish.progressGapSecHint': 'Minimum seconds between spoken progress lines in one session. Turn endings are exempt.',
  'fish.speakEnabled': 'Voice announcements',
  'fish.speakEnabledHint':
    'Master switch: when off, progress, turn and waiting lines stay silent while bubbles still show. The three per-kind switches below apply while it is on.',
  'fish.speakProgress': 'Speak task progress',
  'fish.speakProgressHint': 'Speak the latest line while thinking, working, or tidying up.',
  'fish.speakTurnEnd': 'Speak turn endings',
  'fish.speakTurnEndHint': 'Speak once at every turn end (completed, failed, or an intermediate goal round).',
  'fish.speakWaiting': 'Speak waiting states',
  'fish.speakWaitingHint': 'Speak when approvals, questions, or plan reviews are waiting for you.',
  'fish.resetPositions': 'Reset fish positions',
  'fish.positionsReset': 'Positions reset; fish return beside the pet.',
  'fish.preview': 'Preview',
  // 底部操作栏、重置、改动圆点与拆分后的卡片标题（会话鱼并入本页时新增）。
  tabPet: 'Pet',
  intro:
    'Everything is grouped by function: pets, session fish, behavior, appearance, sound, chat and system. Change what you need, then use Apply or OK at the bottom — a dot marks settings and tabs with unsaved changes.',
  petCardHint:
    'Per-pet configuration: name / size / display / corner / offsets / five feature switches. Use Apply or OK at the bottom to save.',
  tabFish: 'Session fish',
  tabBehavior: 'Behavior',
  tabAudio: 'Sound',
  tabChat: 'Chat',
  tabSystem: 'System',
  barGroup: 'Settings actions',
  barConfirm: 'OK',
  barCancel: 'Cancel',
  barApply: 'Apply',
  barRestart: 'Restart',
  barConfirmHint: 'Save all changes and close the settings page.',
  barCancelHint: 'Close the settings page and discard unsaved changes (the next visit reloads the configuration).',
  barApplyHint: 'Save all changes without closing.',
  barRestartHint: 'Save first, then let the host recompose this plugin and rebuild the desktop window.',
  restarting: 'Restarting the plugin…',
  restartHmr: 'Plugin restarted; the page will reload shortly.',
  restartHelper:
    'HMR is unavailable: the desktop window was rebuilt, but host code changes still need a profile restart.',
  restartFailed: 'Could not restart the plugin — check the plugin log.',
  resetSettings: 'Reset settings',
  resetHint:
    'Restore every setting to the project defaults (pets, personas, physics, font, sound, voice, models and session fish). Confirming writes immediately.',
  confirmReset:
    'Reset everything? The built-in default configuration will overwrite yours: pets, custom personas, sound / physics / font and everything else return to defaults, and comments in the configuration file are rewritten. Session fish settings are reset as well. This cannot be undone.',
  resetDone: 'Reset to the built-in defaults.',
  resetError: 'Reset failed. Check the server connection and write permissions for the configuration directory.',
  resetPartial:
    'The main configuration was reset, but the session fish settings were not written: check that the data directory is writable.',
  unsaved: 'Unsaved changes',
  sfxMasterTitle: 'Sound master',
  sfxMasterHint:
    'The master switch, keep-alive warm-up and master volume apply to every effect; which slot plays which file is decided by “Event sounds” below.',
  systemTitle: 'System and desktop',
  systemHint:
    'These switches only change how this machine notifies you and how the window behaves; pet actions and voice are unaffected.',
  'fish.cardTitle': 'Session fish',
  // 设置备份与恢复（系统分区）；两份原文 + 每个种类配置，恢复前留 .bak。
  backupTitle: 'Backup and restore',
  backupHint:
    "Backs up the raw text of three editable settings: the main config (pets and global preferences), each file pet's kind config, and the session fish settings. Comments and field order survive a round trip. Not included: avatar images, chat memory, todos, logs, or browser position memory. Restoring overwrites the same files (a .bak is kept first); kind files missing from the backup are left alone.",
  backupExport: 'Export backup',
  backupRestore: 'Restore from backup',
  backupDone: 'Backup exported.',
  backupExportFailed: 'Export failed: the host did not respond.',
  backupReadFailed: 'This file is not a settings backup for this plugin.',
  backupUnsupported: 'The backup comes from a newer plugin version — update the plugin before restoring.',
  backupTooLarge: 'The backup is too large or has too many entries; it was rejected.',
  restoreDone: 'Restored from backup; settings are live.',
  restoreFailed: 'Restore failed: {message}',
  confirmRestore:
    'Overwrite the current settings with “{name}”? The three configuration files are written back verbatim (existing files get a .bak first). This cannot be undone.',
  restoreConfirm: 'Restore',
};
