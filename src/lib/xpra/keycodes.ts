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

// Map common JS Key values to X11 key names
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
  ControlLeft: { keyname: 'Control_L', keyval: 0xffe3 },
  ControlRight: { keyname: 'Control_R', keyval: 0xffe4 },
  Shift: { keyname: 'Shift_L', keyval: 0xffe1 },
  ShiftLeft: { keyname: 'Shift_L', keyval: 0xffe1 },
  ShiftRight: { keyname: 'Shift_R', keyval: 0xffe2 },
  Alt: { keyname: 'Alt_L', keyval: 0xffe9 },
  AltLeft: { keyname: 'Alt_L', keyval: 0xffe9 },
  AltRight: { keyname: 'Alt_R', keyval: 0xffea },
  Meta: { keyname: 'Meta_L', keyval: 0xffe7 },
  MetaLeft: { keyname: 'Meta_L', keyval: 0xffe7 },
  MetaRight: { keyname: 'Meta_R', keyval: 0xffe8 },
  CapsLock: { keyname: 'Caps_Lock', keyval: 0xffe5 },
  ' ': { keyname: 'space', keyval: 0x0020 },
  Space: { keyname: 'space', keyval: 0x0020 },
}

// Function keys F1 - F12
for (let i = 1; i <= 12; i++) {
  SPECIAL_KEYS[`F${i}`] = { keyname: `F${i}`, keyval: 0xffbd + i }
}

export function translateKeyEvent(e: KeyboardEvent | { key: string; code?: string }): KeyInfo {
  const rawKey = e.key
  const code = ('code' in e && e.code) ? e.code : ''

  if (SPECIAL_KEYS[code]) {
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
      str: rawKey === ' ' ? ' ' : '',
      keycode: 0,
      group: 0,
    }
  }

  // Printable single characters
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
