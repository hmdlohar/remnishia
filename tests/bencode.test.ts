import { bencode, bdecode } from '../src/lib/xpra/bencode'

declare const process: { exit: (code: number) => void }

function roundtrip(v: unknown): unknown {
  return bdecode(bencode(v as never))
}

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

const cases: [string, unknown, unknown][] = [
  ['int', 42, 42],
  ['bool', true, 1],
  ['string->bytes', 'hello', bytes('hello')],
  ['bytes stay bytes', new Uint8Array([1, 2, 250]), new Uint8Array([1, 2, 250])],
  ['list', ['ping', 7], [bytes('ping'), 7]],
  ['dict', { a: 1, b: 'x' }, { a: 1, b: bytes('x') }],
  ['hello-like', ['hello', { client_type: 'HTML5', share: true }], [bytes('hello'), { client_type: bytes('HTML5'), share: 1 }]],
]

let failures = 0
for (const [name, input, expected] of cases) {
  const got = JSON.stringify(roundtrip(input))
  const want = JSON.stringify(expected)
  if (got !== want) {
    failures++
    console.error(`FAIL ${name}:\n  got  ${got}\n  want ${want}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

// non-latin1 string must round-trip as unicode via the "u" prefix
const uni = bdecode(bencode('naïve ✓'))
if (typeof uni !== 'string' || uni !== 'naïve ✓') {
  failures++
  console.error('FAIL unicode string: got', uni)
} else {
  console.log('ok   unicode string')
}

process.exit(failures ? 1 : 0)
