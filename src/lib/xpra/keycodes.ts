/**
 * X11 keysym mappings and keyboard event translator.
 * Port of Keycodes.js mappings for Xpra server compatibility.
 */

export interface KeyInfo {
  keyname: string
  keyval: number
  str: string
  keycode: number
  group: number
}

// Map common JS Key values and punctuation to X11 key names and keysyms
const SPECIAL_KEYS: Record<string, { keyname: string; keyval: number }> = {
  Escape: { keyname: 'Escape', keyval: 0xff1b },
  Tab: { keyname: 'Tab', keyval: 0xff09 },
  Enter: { keyname: 'Return', keyval: 0xff0d },
  Return: { keyname: 'Return', keyval: 0xff0d },
  Backspace: { keyname: 'BackSpace', keyval: 0xff08 },
  Delete: { keyname: 'Delete', keyval: 0xffff },
  Insert: { keyname: 'Insert', keyval: 0xff63 },
  Home: { keyname: 'Home', keyval: 0xff50 },
  End: { keyname: 'End', keyval: 0xff57 },
  PageUp: { keyname: 'Prior', keyval: 0xff55 },
  PageDown: { keyname: 'Next', keyval: 0xff56 },
  ArrowUp: { keyname: 'Up', keyval: 0xff52 },
  ArrowDown: { keyname: 'Down', keyval: 0xff54 },
  ArrowLeft: { keyname: 'Left', keyval: 0xff51 },
  ArrowRight: { keyname: 'Right', keyval: 0xff53 },
  Control: { keyname: 'Control_L', keyval: 0xffe3 },
  Control_L: { keyname: 'Control_L', keyval: 0xffe3 },
  Control_R: { keyname: 'Control_R', keyval: 0xffe4 },
  ControlLeft: { keyname: 'Control_L', keyval: 0xffe3 },
  ControlRight: { keyname: 'Control_R', keyval: 0xffe4 },
  Shift: { keyname: 'Shift_L', keyval: 0xffe1 },
  Shift_L: { keyname: 'Shift_L', keyval: 0xffe1 },
  Shift_R: { keyname: 'Shift_R', keyval: 0xffe2 },
  ShiftLeft: { keyname: 'Shift_L', keyval: 0xffe1 },
  ShiftRight: { keyname: 'Shift_R', keyval: 0xffe2 },
  Alt: { keyname: 'Alt_L', keyval: 0xffe9 },
  Alt_L: { keyname: 'Alt_L', keyval: 0xffe9 },
  Alt_R: { keyname: 'Alt_R', keyval: 0xffea },
  AltLeft: { keyname: 'Alt_L', keyval: 0xffe9 },
  AltRight: { keyname: 'Alt_R', keyval: 0xffea },
  Meta: { keyname: 'Meta_L', keyval: 0xffe7 },
  Meta_L: { keyname: 'Meta_L', keyval: 0xffe7 },
  Meta_R: { keyname: 'Meta_R', keyval: 0xffe8 },
  MetaLeft: { keyname: 'Meta_L', keyval: 0xffe7 },
  MetaRight: { keyname: 'Meta_R', keyval: 0xffe8 },
  Super_L: { keyname: 'Super_L', keyval: 0xffeb },
  Super_R: { keyname: 'Super_R', keyval: 0xffec },
  CapsLock: { keyname: 'Caps_Lock', keyval: 0xffe5 },
  ' ': { keyname: 'space', keyval: 0x0020 },
  Space: { keyname: 'space', keyval: 0x0020 },

  // Punctuation & Symbols (Crucial for X11 server keysym recognition)
  '.': { keyname: 'period', keyval: 0x002e },
  ',': { keyname: 'comma', keyval: 0x002c },
  '-': { keyname: 'minus', keyval: 0x002d },
  '/': { keyname: 'slash', keyval: 0x002f },
  ':': { keyname: 'colon', keyval: 0x003a },
  ';': { keyname: 'semicolon', keyval: 0x003b },
  '<': { keyname: 'less', keyval: 0x003c },
  '=': { keyname: 'equal', keyval: 0x003d },
  '>': { keyname: 'greater', keyval: 0x003e },
  '?': { keyname: 'question', keyval: 0x003f },
  '@': { keyname: 'at', keyval: 0x0040 },
  '[': { keyname: 'bracketleft', keyval: 0x005b },
  '\\': { keyname: 'backslash', keyval: 0x005c },
  ']': { keyname: 'bracketright', keyval: 0x005d },
  '^': { keyname: 'asciicircum', keyval: 0x005e },
  '_': { keyname: 'underscore', keyval: 0x005f },
  '`': { keyname: 'grave', keyval: 0x0060 },
  '{': { keyname: 'braceleft', keyval: 0x007b },
  '|': { keyname: 'bar', keyval: 0x007c },
  '}': { keyname: 'braceright', keyval: 0x007d },
  '~': { keyname: 'asciitilde', keyval: 0x007e },
  '!': { keyname: 'exclam', keyval: 0x0021 },
  '"': { keyname: 'quotedbl', keyval: 0x0022 },
  '#': { keyname: 'numbersign', keyval: 0x0023 },
  '$': { keyname: 'dollar', keyval: 0x0024 },
  '%': { keyname: 'percent', keyval: 0x0025 },
  '&': { keyname: 'ampersand', keyval: 0x0026 },
  "'": { keyname: 'apostrophe', keyval: 0x0027 },
  '(': { keyname: 'parenleft', keyval: 0x0028 },
  ')': { keyname: 'parenright', keyval: 0x0029 },
  '*': { keyname: 'asterisk', keyval: 0x002a },
  '+': { keyname: 'plus', keyval: 0x002b },
}

// Function keys F1 - F12
for (let i = 1; i <= 12; i++) {
  SPECIAL_KEYS[`F${i}`] = { keyname: `F${i}`, keyval: 0xffbd + i }
}

export function getKeyInfo(key: string): { keyname: string; keyval: number } {
  if (SPECIAL_KEYS[key]) return SPECIAL_KEYS[key]
  if (key.length === 1) {
    return { keyname: key, keyval: key.codePointAt(0) ?? 0 }
  }
  return { keyname: key, keyval: 0 }
}

export function translateKeyEvent(e: KeyboardEvent | { key: string; code?: string }): KeyInfo {
  const rawKey = e.key
  const code = ('code' in e && e.code) ? e.code : ''

  if (code && SPECIAL_KEYS[code]) {
    const s = SPECIAL_KEYS[code]
    return {
      keyname: s.keyname,
      keyval: s.keyval,
      str: '',
      keycode: 0,
      group: 0,
    }
  }

  if (SPECIAL_KEYS[rawKey]) {
    const s = SPECIAL_KEYS[rawKey]
    return {
      keyname: s.keyname,
      keyval: s.keyval,
      str: rawKey,
      keycode: 0,
      group: 0,
    }
  }

  // Printable single characters (letters, numbers)
  if (rawKey.length === 1) {
    const codePoint = rawKey.codePointAt(0) ?? 0
    return {
      keyname: rawKey,
      keyval: codePoint,
      str: rawKey,
      keycode: 0,
      group: 0,
    }
  }

  return {
    keyname: rawKey,
    keyval: 0,
    str: '',
    keycode: 0,
    group: 0,
  }
}
