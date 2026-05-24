import { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, Pressable, StyleSheet, SafeAreaView,
  StatusBar, Platform, Dimensions, ScrollView,
} from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'

// ── constants ─────────────────────────────────────────────────────────────────
const ACCENT = '#D4FF3A'
const MONO   = Platform.OS === 'ios' ? 'Menlo' : 'monospace'
const SW     = Dimensions.get('window').width
const RING_SIZE = Math.min(SW - 48, 320)
const RING_R    = RING_SIZE / 2 - 8
const RING_C    = 2 * Math.PI * RING_R

const C = {
  bgLight:  '#F4F1EC',
  ink:      '#15171A',
  ink2:     '#5A5E66',
  ink3:     '#9499A1',
  hairline: 'rgba(20,22,26,0.08)',
  bgDark:   '#0B0C0E',
  inkDark:  '#F5F5F4',
  inkDark2: 'rgba(245,245,244,0.55)',
  inkDark3: 'rgba(245,245,244,0.28)',
}

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtTime(s) {
  s = Math.max(0, Math.ceil(s))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

function calcDelta(actual, target) {
  const diff = actual - target
  if (Math.abs(diff) < 0.5) return { kind: 'on-pace', text: 'On pace' }
  const faster = diff < 0
  const abs = Math.abs(diff)
  const m = Math.floor(abs / 60)
  const sec = Math.round(abs % 60)
  const num = m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`
  return { kind: faster ? 'faster' : 'slower', text: `${faster ? '−' : '+'}${num}` }
}

function useInterval(callback, delay) {
  const saved = useRef(callback)
  useEffect(() => { saved.current = callback }, [callback])
  useEffect(() => {
    if (delay == null) return
    const id = setInterval(() => saved.current(), delay)
    return () => clearInterval(id)
  }, [delay])
}

// ── Mock history data ─────────────────────────────────────────────────────────
function fakeTimes(n, target, profile) {
  const out = []
  for (let i = 0; i < n; i++) {
    let d
    if (profile === 'fast')   d = -(2 + ((i * 7) % 5))
    else if (profile === 'slow')  d = 2 + ((i * 11) % 7)
    else if (profile === 'mixed') d = ((i * 13) % 11) - 5
    else d = ((i * 5) % 5) - 2
    out.push(Math.max(2, target + d))
  }
  return out
}

const PAST_WORKOUTS = [
  { id: 'w1',  dateOffset: 0,   sets: 6,  work: 45, rest: 15, label: 'EMOM',      actualTimes: fakeTimes(6,  45, 'mixed') },
  { id: 'w2',  dateOffset: -1,  sets: 8,  work: 30, rest: 10, label: 'Sprints',   actualTimes: fakeTimes(8,  30, 'fast') },
  { id: 'w3',  dateOffset: -2,  sets: 5,  work: 60, rest: 30, label: 'Tabata',    actualTimes: fakeTimes(5,  60, 'paced') },
  { id: 'w4',  dateOffset: -4,  sets: 4,  work: 90, rest: 30, label: 'Long sets', actualTimes: null },
  { id: 'w5',  dateOffset: -6,  sets: 10, work: 20, rest: 10, label: 'Tabata',    actualTimes: fakeTimes(10, 20, 'slow') },
  { id: 'w6',  dateOffset: -7,  sets: 6,  work: 45, rest: 20, label: 'EMOM',      actualTimes: fakeTimes(6,  45, 'paced') },
  { id: 'w7',  dateOffset: -9,  sets: 5,  work: 45, rest: 15, label: 'Standard',  actualTimes: null },
  { id: 'w8',  dateOffset: -11, sets: 8,  work: 30, rest: 15, label: 'Sprints',   actualTimes: fakeTimes(8,  30, 'mixed') },
  { id: 'w9',  dateOffset: -14, sets: 6,  work: 60, rest: 20, label: 'EMOM',      actualTimes: fakeTimes(6,  60, 'fast') },
  { id: 'w10', dateOffset: -16, sets: 4,  work: 60, rest: 30, label: 'Long sets', actualTimes: null },
]

function totalSecs(w) { return w.sets * w.work + Math.max(0, w.sets - 1) * w.rest }

function relativeDate(offset) {
  if (offset === 0)  return 'Today'
  if (offset === -1) return 'Yesterday'
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })}, ${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}`
}

function bucketLabel(offset) {
  if (offset >= -1)  return 'Recent'
  if (offset >= -7)  return 'This week'
  if (offset >= -30) return 'Earlier'
  return 'Older'
}

// ── Field definitions ─────────────────────────────────────────────────────────
const FIELDS = {
  sets: {
    key: 'sets', label: 'Sets', kind: 'int', unit: 'Reps',
    subtitle: "How many work intervals you'll do.",
    min: 1, max: 99,
    helperFn: (v, c) => v > 0 && { label: 'Total time ', value: fmtTime(v * c.work + Math.max(0, v - 1) * c.rest) },
  },
  work: {
    key: 'work', label: 'Work', kind: 'duration', unit: 'Minutes : Seconds',
    subtitle: 'Duration of each active interval.',
    min: 5, max: 5999,
    helperFn: (v, c) => v > 0 && { label: 'Total work ', value: fmtTime(c.sets * v) },
  },
  rest: {
    key: 'rest', label: 'Rest', kind: 'duration', unit: 'Minutes : Seconds',
    subtitle: 'Recovery between intervals.',
    min: 0, max: 5999,
    helperFn: (v, c) => v >= 0 && { label: 'Total rest ', value: fmtTime(Math.max(0, c.sets - 1) * v) },
  },
  distance: {
    key: 'distance', label: 'Distance', kind: 'distance', unit: 'Kilometres',
    subtitle: 'Optional goal per interval. Set to 0 to skip.',
    helperFn: (v) => v > 0 && { label: 'Per set ', value: (v / 1000).toFixed(2) + ' km' },
  },
}

// ── Keypad helpers ────────────────────────────────────────────────────────────
function fmtBuf(kind, buf) {
  if (kind === 'int') return buf === '' ? '0' : buf
  if (kind === 'duration') {
    const t = buf.replace(/\D/g, '').slice(-4).padStart(4, '0')
    return t.slice(0, 2) + ':' + t.slice(2, 4)
  }
  if (kind === 'distance') {
    if (buf === '') return '0.00'
    const [i, d] = buf.split('.')
    if (d == null) return i + '.00'
    if (d.length === 0) return i + '.'
    if (d.length === 1) return i + '.' + d + '0'
    return i + '.' + d.slice(0, 2)
  }
  return buf
}

function bufToVal(kind, buf) {
  if (kind === 'int') return parseInt(buf || '0', 10)
  if (kind === 'duration') {
    const t = buf.replace(/\D/g, '').slice(-4).padStart(4, '0')
    return parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(2, 4), 10)
  }
  if (kind === 'distance') return Math.round(parseFloat(buf || '0') * 1000)
  return 0
}

function applyKey(kind, buf, key) {
  if (key === 'back') return buf ? buf.slice(0, -1) : ''
  if (kind === 'int') {
    if (key === '.') return buf
    if (buf.length >= 2) return buf
    return (buf + key).replace(/^0+/, '') || key
  }
  if (kind === 'duration') {
    if (key === '.') return buf
    if (buf.length >= 4) return buf
    return buf + key
  }
  if (kind === 'distance') {
    if (key === '.') {
      if (buf.includes('.')) return buf
      return (buf || '0') + '.'
    }
    if (buf.includes('.')) {
      const [i, d] = buf.split('.')
      if (d.length >= 2) return buf
      return buf + key
    }
    if (buf.length >= 3) return buf
    return (buf + key).replace(/^0+(?=\d)/, '')
  }
  return buf
}

// ── KeyCell ───────────────────────────────────────────────────────────────────
function KeyCell({ digit, sub, onPress }) {
  return (
    <Pressable
      style={({ pressed }) => [s.kpKey, pressed && s.kpKeyPressed]}
      onPress={() => onPress(digit)}
      accessibilityLabel={String(digit)}
    >
      <Text style={s.kpDigit}>{digit}</Text>
      {sub ? <Text style={s.kpSub}>{sub}</Text> : null}
    </Pressable>
  )
}

// ── Keypad ────────────────────────────────────────────────────────────────────
function Keypad({ kind, onPress }) {
  const rows = [
    [{ d: '1' }, { d: '2', s: 'ABC' }, { d: '3', s: 'DEF' }],
    [{ d: '4', s: 'GHI' }, { d: '5', s: 'JKL' }, { d: '6', s: 'MNO' }],
    [{ d: '7', s: 'PQRS' }, { d: '8', s: 'TUV' }, { d: '9', s: 'WXYZ' }],
  ]
  return (
    <View style={s.kpGrid}>
      {rows.map((row, ri) => (
        <View key={ri} style={s.kpRow}>
          {row.map(({ d, s: sub }) => <KeyCell key={d} digit={d} sub={sub} onPress={onPress} />)}
        </View>
      ))}
      <View style={s.kpRow}>
        {kind === 'distance' ? (
          <Pressable
            style={({ pressed }) => [s.kpKey, s.kpKeyAux, pressed && s.kpKeyAuxPressed]}
            onPress={() => onPress('.')}
          >
            <Text style={[s.kpDigit, { fontSize: 22 }]}>.</Text>
          </Pressable>
        ) : (
          <View style={[s.kpKey, { opacity: 0 }]} />
        )}
        <KeyCell digit="0" onPress={onPress} />
        <Pressable
          style={({ pressed }) => [s.kpKey, s.kpKeyAux, pressed && s.kpKeyAuxPressed]}
          onPress={() => onPress('back')}
          accessibilityLabel="Delete"
        >
          <Svg width={26} height={20} viewBox="0 0 26 20">
            <Path d="M8 2L1.5 10L8 18H24a1 1 0 001-1V3a1 1 0 00-1-1H8z"
              stroke={C.inkDark2} strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
            <Path d="M12 7l8 6M20 7l-8 6" stroke={C.inkDark2} strokeWidth="1.5" strokeLinecap="round"/>
          </Svg>
        </Pressable>
      </View>
    </View>
  )
}

// ── KeypadEditor ──────────────────────────────────────────────────────────────
function KeypadEditor({ field, initial, config, onCancel, onSet }) {
  const [buf, setBuf] = useState('')
  const live      = fmtBuf(field.kind, buf)
  const liveValue = bufToVal(field.kind, buf)
  const helper    = field.helperFn ? field.helperFn(liveValue, config) : null

  const onCommit = () => {
    let v = liveValue
    if (field.kind === 'int')      v = Math.max(field.min ?? 1, Math.min(field.max ?? 99,   v || initial))
    if (field.kind === 'duration') v = Math.max(field.min ?? 0, Math.min(field.max ?? 5999, v))
    if (field.kind === 'distance') v = Math.max(0, Math.min(99990, v))
    onSet(v)
  }

  return (
    <View style={s.kpEditor}>
      <View style={s.kpHeader}>
        <Pressable onPress={onCancel}><Text style={s.kpCancelBtn}>Cancel</Text></Pressable>
        <Text style={s.kpTitle}>{field.label}</Text>
        <Pressable onPress={onCommit}><Text style={s.kpSetBtn}>Set</Text></Pressable>
      </View>

      <View style={s.kpBody}>
        {field.subtitle
          ? <Text style={s.kpSubtitle}>{field.subtitle}</Text>
          : null}
        <View style={s.kpValueWrap}>
          <Text style={s.kpValue}>{live}</Text>
          <View style={s.kpUnderline} />
        </View>
        <Text style={s.kpUnit}>{field.unit}</Text>
        {helper
          ? <Text style={s.kpHelper}>{helper.label}<Text style={s.kpHelperVal}>{helper.value}</Text></Text>
          : null}
      </View>

      <View style={s.kpPad}>
        <Keypad kind={field.kind} onPress={key => setBuf(b => applyKey(field.kind, b, key))} />
      </View>
    </View>
  )
}

// ── TapRow ────────────────────────────────────────────────────────────────────
function TapRow({ label, value, unit, faded, onTap }) {
  return (
    <Pressable style={({ pressed }) => [s.tapRow, pressed && s.tapRowPressed]} onPress={onTap}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.tapRowRight}>
        <Text style={[s.rowNum, faded && s.rowNumFaded]}>{value}</Text>
        {unit ? <Text style={s.rowSuffix}>{unit}</Text> : null}
        <Svg width={8} height={12} viewBox="0 0 8 12" style={{ marginLeft: 4 }}>
          <Path d="M2 2l4 4-4 4" stroke={C.inkDark3} strokeWidth="1.5" fill="none"
            strokeLinecap="round" strokeLinejoin="round"/>
        </Svg>
      </View>
    </Pressable>
  )
}

// ── DeltaBadge ────────────────────────────────────────────────────────────────
function DeltaBadge({ actual, target, compact, dark }) {
  if (actual == null || target == null) return null
  const d = calcDelta(actual, target)
  const bg   = d.kind === 'faster' ? (dark ? 'rgba(135,224,163,0.16)' : 'rgba(42,132,71,0.10)')
             : d.kind === 'slower' ? (dark ? 'rgba(255,164,122,0.18)' : 'rgba(178,68,14,0.10)')
             : (dark ? 'rgba(245,245,244,0.08)' : 'rgba(20,22,26,0.06)')
  const fg   = d.kind === 'faster' ? (dark ? '#87E0A3' : '#2A8447')
             : d.kind === 'slower' ? (dark ? '#FFA47A' : '#B2440E')
             : (dark ? 'rgba(245,245,244,0.65)' : 'rgba(20,22,26,0.55)')
  return (
    <View style={[s.badge, { backgroundColor: bg }, compact && s.badgeCompact]}>
      <Text style={[s.badgeText, { color: fg }, compact && s.badgeTextSm,
        d.kind === 'on-pace' && { fontWeight: '500' }]}>
        {d.text}
      </Text>
    </View>
  )
}

// ── DeltaBar ──────────────────────────────────────────────────────────────────
function DeltaBar({ actual, target, dark }) {
  const diff = actual - target
  const norm = Math.max(-1, Math.min(1, diff / Math.max(target * 0.5, 5)))
  const pct  = 50 + norm * 50
  return (
    <View style={s.dBar}>
      <View style={[s.dBarLine,   dark && s.dBarLineDark]} />
      <View style={[s.dBarCenter, dark && s.dBarCenterDark]} />
      <View style={[s.dBarDot,    dark && s.dBarDotDark, { left: `${pct}%` }]} />
    </View>
  )
}

// ── Setup screen ──────────────────────────────────────────────────────────────
function Setup({ config, setConfig, onStart, onHistory }) {
  const [editing, setEditing] = useState(null)

  if (editing) {
    return (
      <KeypadEditor
        field={FIELDS[editing]}
        initial={config[editing]}
        config={config}
        onCancel={() => setEditing(null)}
        onSet={v => { setConfig(c => ({ ...c, [editing]: v })); setEditing(null) }}
      />
    )
  }

  const totalTime = config.sets * config.work + Math.max(0, config.sets - 1) * config.rest
  const distLabel = config.distance > 0 ? (config.distance / 1000).toFixed(2) : 'Off'

  return (
    <View style={s.setup}>
      <View style={s.setupNav}>
        <View style={{ width: 38 }} />
        <Pressable
          style={({ pressed }) => [s.navBtn, pressed && { backgroundColor: 'rgba(255,255,255,0.10)' }]}
          onPress={onHistory}
          accessibilityLabel="History"
        >
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <Circle cx={8} cy={8} r={6} stroke={C.inkDark2} strokeWidth="1.4"/>
            <Path d="M8 4.5V8l2.2 1.6" stroke={C.inkDark2} strokeWidth="1.4" strokeLinecap="round"/>
          </Svg>
        </Pressable>
      </View>

      <View style={s.setupHead}>
        <Text style={s.eyebrow}>Interval timer</Text>
        <Text style={s.title}>New workout</Text>
      </View>

      <View style={s.tapRows}>
        <TapRow label="Sets"     value={String(config.sets)}  onTap={() => setEditing('sets')} />
        <TapRow label="Work"     value={fmtTime(config.work)} onTap={() => setEditing('work')} />
        <TapRow label="Rest"     value={fmtTime(config.rest)} onTap={() => setEditing('rest')} />
        <TapRow
          label="Distance"
          value={distLabel}
          unit={config.distance > 0 ? 'km' : null}
          faded={config.distance === 0}
          onTap={() => setEditing('distance')}
        />
      </View>

      <View style={s.summary}>
        <View style={s.sumLine}>
          <Text style={[s.sumText, { fontWeight: '500', color: C.inkDark }]}>Total time</Text>
          <Text style={[s.sumVal,  { fontWeight: '500', color: C.inkDark }]}>{fmtTime(totalTime)}</Text>
        </View>
        <View style={s.sumLine}>
          <Text style={s.sumText}>Active work</Text>
          <Text style={s.sumVal}>{fmtTime(config.sets * config.work)}</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [s.begin, { backgroundColor: ACCENT, opacity: pressed ? 0.9 : 1 }]}
        onPress={onStart}
      >
        <Text style={s.beginText}>Begin workout  →</Text>
      </Pressable>
    </View>
  )
}

// ── Distance Work View ────────────────────────────────────────────────────────
function DistanceWorkView({ config, state, setState, onQuit, accent }) {
  const { setIdx, remaining, paused, dist = 0, elapsed = 0, overtime } = state
  const distKm   = dist / 1000
  const targetKm = config.distance / 1000
  const progress = Math.min(1, dist / Math.max(1, config.distance))

  const paceStr = (() => {
    if (dist < 8) return "--'--\""
    const spk = elapsed * 1000 / dist
    if (spk > 999) return "--'--\""
    return `${Math.floor(spk / 60)}'${String(Math.floor(spk % 60)).padStart(2, '0')}"`
  })()

  const timeStr  = overtime ? `+${fmtTime(elapsed - config.work)}` : fmtTime(remaining)
  const timeLabel = overtime ? 'Over' : 'Time'

  return (
    <View style={s.dw}>
      <View style={s.dwTop}>
        <Pressable style={s.dwX} onPress={onQuit}>
          <Svg width={14} height={14} viewBox="0 0 14 14">
            <Path d="M3 3l8 8M11 3l-8 8" stroke={C.inkDark} strokeWidth="1.7" strokeLinecap="round"/>
          </Svg>
        </Pressable>
        <Text style={s.dwSetLbl}>
          SET <Text style={s.dwSetNum}>{setIdx}</Text>
          <Text style={s.dwSetOf}> / {config.sets}</Text>
        </Text>
        <View style={{ width: 36 }} />
      </View>

      <View style={s.dwStats}>
        {[
          { val: paceStr,  lbl: 'Pace',  align: 'flex-start' },
          { val: '--',     lbl: 'BPM',   align: 'center' },
          { val: timeStr,  lbl: timeLabel, align: 'flex-end', over: overtime },
        ].map(({ val, lbl, align, over }) => (
          <View key={lbl} style={[s.dwStat, { alignItems: align }]}>
            <Text style={[s.dwStatVal, over && { color: '#B23A0E' }]}>{val}</Text>
            <Text style={s.dwStatLbl}>{lbl}</Text>
          </View>
        ))}
      </View>

      <View style={s.dwMain}>
        <Text style={s.dwBig}>{distKm.toFixed(2)}</Text>
        <Text style={s.dwUnit}>Kilometres · target {targetKm.toFixed(2)}</Text>
      </View>

      <View style={s.dwProgressWrap}>
        <View style={s.dwProgressTrack} />
        <View style={[s.dwProgressFill, { width: `${progress * 100}%` }]} />
      </View>

      <View style={s.dwBottom}>
        <Pressable
          style={({ pressed }) => [s.dwPause, pressed && { opacity: 0.8 }]}
          onPress={() => setState(p => ({ ...p, paused: !p.paused }))}
        >
          {paused ? (
            <Svg width={18} height={20} viewBox="0 0 18 20">
              <Path d="M2 1l14 9-14 9z" fill={C.inkDark}/>
            </Svg>
          ) : (
            <Svg width={16} height={18} viewBox="0 0 16 18">
              <Rect x="1" y="1" width="4.5" height="16" rx="0.7" fill={C.inkDark}/>
              <Rect x="10.5" y="1" width="4.5" height="16" rx="0.7" fill={C.inkDark}/>
            </Svg>
          )}
        </Pressable>
        <View style={s.dwDots}>
          {Array.from({ length: config.sets }).map((_, i) => (
            <View key={i} style={[
              s.dwDot,
              i + 1 === setIdx && s.dwDotActive,
              i + 1 < setIdx  && s.dwDotDone,
            ]} />
          ))}
        </View>
      </View>
    </View>
  )
}

// ── Workout screen ────────────────────────────────────────────────────────────
function Workout({ config, state, setState, onQuit, accent = ACCENT }) {
  const { phase, setIdx, remaining, paused } = state
  const isWork  = phase === 'work'
  const isRest  = phase === 'rest'
  const isReady = phase === 'ready'
  const distMode = config.distance > 0
  const total    = isWork ? config.work : isRest ? config.rest : 3
  const progress = 1 - remaining / total
  const dashOff  = RING_C * progress
  const tint     = isWork ? C.inkDark : isRest ? '#7B8DA0' : C.inkDark

  useInterval(() => {
    setState(prev => {
      if (prev.paused) return prev
      const dt   = 0.1
      const next = +(prev.remaining - dt).toFixed(2)
      if (next > 0) {
        const elapsed = prev.phase === 'work' ? (prev.elapsed || 0) + dt : prev.elapsed
        return { ...prev, remaining: next, elapsed }
      }
      if (prev.phase === 'ready') {
        return { ...prev, phase: 'work', remaining: config.work, elapsed: 0, dist: 0 }
      }
      if (prev.phase === 'work') {
        const newTimes = [...(prev.actualTimes || []), config.work]
        if (prev.setIdx >= config.sets)
          return { ...prev, phase: 'complete', remaining: 0, actualTimes: newTimes }
        if (config.rest <= 0)
          return { ...prev, phase: 'work', setIdx: prev.setIdx + 1, remaining: config.work, elapsed: 0, dist: 0, actualTimes: newTimes }
        return { ...prev, phase: 'rest', remaining: config.rest, lastTime: config.work, actualTimes: newTimes }
      }
      if (prev.phase === 'rest') {
        return { ...prev, phase: 'work', setIdx: prev.setIdx + 1, remaining: config.work, elapsed: 0, dist: 0 }
      }
      return prev
    })
  }, phase === 'complete' ? null : 100)

  if (isWork && distMode) {
    return <DistanceWorkView config={config} state={state} setState={setState} onQuit={onQuit} accent={accent} />
  }

  const phaseLabel = isReady ? 'GET READY' : isWork ? 'WORK' : 'REST'
  const bigNum     = isReady ? String(Math.ceil(remaining)) : fmtTime(remaining)

  return (
    <View style={s.workout}>
      <View style={s.woTop}>
        <Pressable style={({ pressed }) => [s.ghost, pressed && { opacity: 0.6 }]} onPress={onQuit}>
          <Text style={{ color: C.inkDark2, fontSize: 16, lineHeight: 20 }}>✕</Text>
        </Pressable>
        <View style={s.woSetRow}>
          <Text style={s.woSetNum}>{Math.min(setIdx, config.sets)}</Text>
          <Text style={s.woSetOf}>/ {config.sets}</Text>
        </View>
        <View style={[s.ghost, { backgroundColor: 'transparent', borderWidth: 0 }]}>
          <Text style={{ color: C.inkDark3, fontSize: 11, letterSpacing: 2, fontWeight: '500' }}>SET</Text>
        </View>
      </View>

      <View style={s.ringWrap}>
        <Svg width={RING_SIZE} height={RING_SIZE}>
          <Circle cx={RING_SIZE/2} cy={RING_SIZE/2} r={RING_R}
            stroke="rgba(255,255,255,0.07)" strokeWidth={2} fill="none" />
          <Circle cx={RING_SIZE/2} cy={RING_SIZE/2} r={RING_R}
            stroke={tint} strokeWidth={3} fill="none"
            strokeDasharray={RING_C} strokeDashoffset={dashOff}
            strokeLinecap="round" rotation={-90} origin={`${RING_SIZE/2}, ${RING_SIZE/2}`}
          />
        </Svg>
        <View style={s.ringContent}>
          <View style={[s.phaseTag, isRest && s.phaseTagRest]}>
            <View style={[s.dot, {
              backgroundColor: tint,
              shadowColor: tint, shadowOpacity: isRest ? 0 : 0.8, shadowRadius: 6,
            }]} />
            <Text style={s.phaseTagText}>{phaseLabel}</Text>
          </View>

          <Text style={[s.bigTime, isReady && s.bigTimeReady]}>{bigNum}</Text>

          {isRest && state.lastTime != null ? (
            <View style={s.lastCard}>
              <Text style={s.lastCardLbl}>SET {setIdx} OF {config.sets}</Text>
              <View style={s.lastCardRow}>
                <Text style={s.lastCardTime}>{fmtTime(state.lastTime)}</Text>
                <DeltaBadge actual={state.lastTime} target={config.work} dark />
              </View>
              <Text style={s.lastCardTarget}>Target {fmtTime(config.work)}</Text>
            </View>
          ) : isRest ? (
            <Text style={s.upnext}>Up next · Set {setIdx + 1}</Text>
          ) : null}

          {isWork  && <Text style={[s.upnext, { color: C.inkDark3 }]}>{config.rest > 0 ? `Rest ${fmtTime(config.rest)} after` : 'No rest'}</Text>}
          {isReady && <Text style={s.upnext}>Starting set 1</Text>}
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [s.pause, pressed && { opacity: 0.8 }]}
        onPress={() => setState(p => ({ ...p, paused: !p.paused }))}
      >
        {paused ? (
          <>
            <Svg width={14} height={16} viewBox="0 0 14 16">
              <Path d="M2 1l11 7-11 7z" fill={C.inkDark}/>
            </Svg>
            <Text style={s.pauseText}>Resume</Text>
          </>
        ) : (
          <>
            <Svg width={12} height={14} viewBox="0 0 12 14">
              <Rect x="1" y="1" width="3.5" height="12" rx="0.6" fill={C.inkDark}/>
              <Rect x="7.5" y="1" width="3.5" height="12" rx="0.6" fill={C.inkDark}/>
            </Svg>
            <Text style={s.pauseText}>Pause</Text>
          </>
        )}
      </Pressable>
    </View>
  )
}

// ── Complete screen ───────────────────────────────────────────────────────────
function Complete({ config, onDone, accent = ACCENT, actualTimes = [] }) {
  const hasT = actualTimes.length > 0
  const times = hasT ? actualTimes : Array.from({ length: config.sets }, () => config.work)
  const totalActive = times.reduce((a, t) => a + t, 0)
  const avgDelta = hasT
    ? times.reduce((a, t) => a + (t - config.work), 0) / times.length
    : 0

  return (
    <View style={s.complete}>
      <View style={s.completeHead}>
        <View style={[s.completeMark, { borderColor: accent }]}>
          <Svg width={22} height={22} viewBox="0 0 34 34">
            <Path d="M7 17l7 7 13-15" stroke={accent} strokeWidth="2.6" fill="none"
              strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </View>
        <Text style={s.completeTitle}>Workout complete</Text>
        {hasT && (
          <View style={s.completeAvg}>
            <Text style={s.completeAvgText}>Average</Text>
            <DeltaBadge actual={config.work + avgDelta} target={config.work} dark />
            <Text style={s.completeAvgText}>vs target</Text>
          </View>
        )}
      </View>

      <View style={s.stats}>
        {[
          { val: String(config.sets), lbl: 'Sets',  align: 'flex-start' },
          { val: fmtTime(totalActive), lbl: 'Work', align: 'center' },
          { val: fmtTime(totalActive + Math.max(0, config.sets - 1) * config.rest), lbl: 'Total', align: 'flex-end' },
        ].map(({ val, lbl, align }) => (
          <View key={lbl} style={[s.stat, { alignItems: align }]}>
            <Text style={s.statVal}>{val}</Text>
            <Text style={s.statLbl}>{lbl}</Text>
          </View>
        ))}
      </View>

      <View style={s.cbTitleRow}>
        <Text style={s.cbTitle}>Per set</Text>
        <Text style={s.cbTargetText}>· Target {fmtTime(config.work)}</Text>
      </View>

      <ScrollView style={s.cbScroll} showsVerticalScrollIndicator={false}>
        {times.map((t, i) => (
          <View key={i} style={s.cbRow}>
            <Text style={s.cbIdx}>{String(i + 1).padStart(2, '0')}</Text>
            <Text style={s.cbTime}>{fmtTime(t)}</Text>
            <View style={{ flex: 1 }}>
              <DeltaBar actual={t} target={config.work} dark />
            </View>
            <DeltaBadge actual={t} target={config.work} compact dark />
          </View>
        ))}
      </ScrollView>

      <Pressable
        style={({ pressed }) => [s.begin, { backgroundColor: accent, opacity: pressed ? 0.9 : 1, marginTop: 14 }]}
        onPress={onDone}
      >
        <Text style={s.beginText}>New workout</Text>
      </Pressable>
    </View>
  )
}

// ── History screen ────────────────────────────────────────────────────────────
function History({ onBack, onPick }) {
  const groups = []
  let lastBucket = null
  PAST_WORKOUTS.forEach(w => {
    const b = bucketLabel(w.dateOffset)
    if (b !== lastBucket) { groups.push({ bucket: b, items: [] }); lastBucket = b }
    groups[groups.length - 1].items.push(w)
  })
  const thisWeek = PAST_WORKOUTS.filter(w => w.dateOffset >= -6)
  const weekTotal = thisWeek.reduce((a, w) => a + totalSecs(w), 0)

  return (
    <View style={s.lightScreen}>
      <View style={s.histTop}>
        <Pressable style={({ pressed }) => [s.navBtn, pressed && { backgroundColor: 'rgba(255,255,255,0.10)' }]} onPress={onBack}>
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path d="M10 3l-5 5 5 5" stroke={C.inkDark2} strokeWidth="1.6" fill="none"
              strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </Pressable>
        <View /><View />
      </View>

      <View style={s.histHead}>
        <Text style={s.eyebrow}>History</Text>
        <Text style={s.title}>Workouts</Text>
        <View style={s.histMeta}>
          <Text style={s.histMetaNum}>{thisWeek.length}</Text>
          <Text style={s.histMetaLbl}>sessions this week</Text>
          <Text style={s.histMetaDot}>·</Text>
          <Text style={s.histMetaNum}>{fmtTime(weekTotal)}</Text>
          <Text style={s.histMetaLbl}>total</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {groups.map(g => (
          <View key={g.bucket} style={s.histGroup}>
            <Text style={s.histBucket}>{g.bucket}</Text>
            {g.items.map(w => (
              <Pressable
                key={w.id}
                style={({ pressed }) => [s.histRow, pressed && { backgroundColor: 'rgba(255,255,255,0.04)' }]}
                onPress={() => onPick(w)}
              >
                <View style={s.histRowLeft}>
                  <Text style={s.histRowDate}>{relativeDate(w.dateOffset)}</Text>
                  <View style={s.histRowSub}>
                    <Text style={s.histRowSubTxt}>{w.sets} sets</Text>
                    <Text style={s.sep}>·</Text>
                    <Text style={s.histRowSubTxt}>{fmtTime(w.work)} work</Text>
                    <Text style={s.sep}>·</Text>
                    <Text style={s.histRowSubTxt}>{fmtTime(w.rest)} rest</Text>
                  </View>
                </View>
                <View style={s.histRowRight}>
                  <Text style={s.histRowTotal}>{fmtTime(totalSecs(w))}</Text>
                  <Svg width={10} height={14} viewBox="0 0 10 14">
                    <Path d="M2 2l5 5-5 5" stroke={C.inkDark3} strokeWidth="1.6" fill="none"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </Svg>
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

// ── Detail screen ─────────────────────────────────────────────────────────────
function Detail({ workout: w, onBack, accent = ACCENT }) {
  const total     = totalSecs(w)
  const totalWork = w.sets * w.work
  const totalRest = Math.max(0, w.sets - 1) * w.rest

  const segments = []
  for (let i = 0; i < w.sets; i++) {
    segments.push({ kind: 'work', secs: w.work })
    if (i < w.sets - 1 && w.rest > 0) segments.push({ kind: 'rest', secs: w.rest })
  }

  return (
    <View style={s.lightScreen}>
      <View style={s.histTop}>
        <Pressable style={({ pressed }) => [s.navBtn, pressed && { backgroundColor: 'rgba(255,255,255,0.10)' }]} onPress={onBack}>
          <Svg width={16} height={16} viewBox="0 0 16 16">
            <Path d="M10 3l-5 5 5 5" stroke={C.inkDark2} strokeWidth="1.6" fill="none"
              strokeLinecap="round" strokeLinejoin="round"/>
          </Svg>
        </Pressable>
        <Text style={s.histTopTitle}>{relativeDate(w.dateOffset)}</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={s.detailHead}>
        <Text style={s.eyebrow}>{w.label}</Text>
        <Text style={s.detailTime}>{fmtTime(total)}</Text>
        <View style={s.histRowSub}>
          <Text style={s.histRowSubTxt}>{w.sets} sets</Text>
          <Text style={s.sep}>·</Text>
          <Text style={s.histRowSubTxt}>{fmtTime(w.work)} work</Text>
          <Text style={s.sep}>·</Text>
          <Text style={s.histRowSubTxt}>{fmtTime(w.rest)} rest</Text>
        </View>
      </View>

      <View style={s.timeline}>
        <View style={s.timelineBar}>
          {segments.map((seg, i) => (
            <View
              key={i}
              style={[s.tlSeg, {
                flex: seg.secs,
                backgroundColor: seg.kind === 'work' ? accent : 'rgba(20,22,26,0.10)',
              }]}
            />
          ))}
        </View>
        <View style={s.timelineLegend}>
          {[
            { color: accent, label: `Work · ${fmtTime(totalWork)}` },
            { color: 'rgba(20,22,26,0.18)', label: `Rest · ${fmtTime(totalRest)}` },
          ].map(({ color, label }) => (
            <View key={label} style={s.legendItem}>
              <View style={[s.legendSwatch, { backgroundColor: color }]} />
              <Text style={s.legendText}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={s.cbTitleRow}>
        <Text style={[s.cbTitle, { color: C.inkDark3 }]}>Per set</Text>
        <Text style={[s.cbTargetText, { color: C.inkDark3 }]}>· Target {fmtTime(w.work)}</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {Array.from({ length: w.sets }).map((_, i) => {
          const actual = w.actualTimes ? w.actualTimes[i] : w.work
          return (
            <View key={i} style={[s.cbRow, { borderTopColor: DH }]}>
              <Text style={[s.cbIdx, { color: C.inkDark3 }]}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={[s.cbTime, { color: C.inkDark }]}>{fmtTime(actual)}</Text>
              <View style={{ flex: 1 }}>
                <DeltaBar actual={actual} target={w.work} />
              </View>
              {w.actualTimes && <DeltaBadge actual={actual} target={w.work} compact />}
            </View>
          )
        })}
        <View style={{ paddingTop: 18, paddingBottom: 4 }}>
          <Pressable
            style={({ pressed }) => [s.begin, { backgroundColor: accent, opacity: pressed ? 0.9 : 1 }]}
            onPress={onBack}
          >
            <Text style={s.beginText}>Repeat workout</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [config, setConfig]     = useState({ sets: 5, work: 45, rest: 15, distance: 0 })
  const [state, setState]       = useState(null)
  const [complete, setComplete] = useState(false)
  const [finalTimes, setFinalTimes] = useState([])
  const [route, setRoute]       = useState('setup')
  const [picked, setPicked]     = useState(null)

  const onStart = useCallback(() => {
    setComplete(false)
    setState({ phase: 'ready', setIdx: 1, remaining: 3, paused: false,
               dist: 0, elapsed: 0, overtime: false, actualTimes: [], lastTime: null })
  }, [])
  const onQuit = useCallback(() => { setState(null); setComplete(false) }, [])
  const onDone = useCallback(() => { setState(null); setComplete(false) }, [])

  useEffect(() => {
    if (state?.phase === 'complete') {
      setFinalTimes(state.actualTimes || [])
      setComplete(true)
      setState(null)
    }
  }, [state])

  let screen
  if (complete) {
    screen = <Complete config={config} onDone={onDone} actualTimes={finalTimes} />
  } else if (state) {
    screen = <Workout config={config} state={state} setState={setState} onQuit={onQuit} />
  } else if (route === 'history') {
    screen = <History onBack={() => setRoute('setup')} onPick={w => { setPicked(w); setRoute('detail') }} />
  } else if (route === 'detail' && picked) {
    screen = <Detail workout={picked} onBack={() => setRoute('history')} />
  } else {
    screen = <Setup config={config} setConfig={setConfig} onStart={onStart} onHistory={() => setRoute('history')} />
  }

  return (
    <SafeAreaView style={[s.root, { backgroundColor: C.bgDark }]}>
      <StatusBar barStyle="light-content" />
      {screen}
    </SafeAreaView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
const DH = 'rgba(245,245,244,0.08)'  // dark hairline

const s = StyleSheet.create({
  root: { flex: 1 },

  // ── Setup
  setup:       { flex: 1, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 32 },
  setupNav:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  setupHead:   { paddingTop: 10, marginBottom: 40 },
  eyebrow:     { fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: C.inkDark3, marginBottom: 10 },
  title:       { fontSize: 34, fontWeight: '600', letterSpacing: -1, color: C.inkDark },
  navBtn:      { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: DH, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },

  tapRows:     { borderTopWidth: 1, borderTopColor: DH, borderBottomWidth: 1, borderBottomColor: DH, marginBottom: 28 },
  tapRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 22, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: DH },
  tapRowPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  tapRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel:    { fontSize: 17, fontWeight: '500', letterSpacing: -0.2, color: C.inkDark },
  rowNum:      { fontSize: 26, fontWeight: '500', fontVariant: ['tabular-nums'], color: C.inkDark, fontFamily: MONO },
  rowNumFaded: { color: C.inkDark3, fontWeight: '400' },
  rowSuffix:   { fontSize: 12, color: C.inkDark3, letterSpacing: 1, textTransform: 'uppercase' },

  summary:  { marginTop: 'auto', paddingBottom: 18, gap: 8 },
  sumLine:  { flexDirection: 'row', justifyContent: 'space-between' },
  sumText:  { fontSize: 13, color: C.inkDark2 },
  sumVal:   { fontSize: 13, color: C.inkDark2, fontVariant: ['tabular-nums'], fontFamily: MONO },
  begin:    { height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  beginText:{ fontSize: 16, fontWeight: '600', color: '#0B0C0E' },

  // ── Keypad Editor
  kpEditor:    { flex: 1, paddingTop: 48, paddingBottom: 28, backgroundColor: C.bgDark },
  kpHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 4 },
  kpTitle:     { fontSize: 15, fontWeight: '600', letterSpacing: -0.1, color: C.inkDark },
  kpCancelBtn: { fontSize: 15, color: C.inkDark2, paddingHorizontal: 6, paddingVertical: 6 },
  kpSetBtn:    { fontSize: 15, color: C.inkDark, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 6 },
  kpBody:      { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 24, paddingBottom: 8 },
  kpSubtitle:  { fontSize: 13, color: C.inkDark2, textAlign: 'center', lineHeight: 18, marginTop: 6, marginBottom: 26 },
  kpValueWrap: { alignItems: 'stretch', marginTop: 8 },
  kpValue:     { fontSize: 70, fontWeight: '300', letterSpacing: -3, color: C.inkDark, fontFamily: MONO, fontVariant: ['tabular-nums'], paddingHorizontal: 8, paddingBottom: 6, textAlign: 'center' },
  kpUnderline: { height: 1.5, backgroundColor: C.inkDark, borderRadius: 2 },
  kpUnit:      { fontSize: 13, color: C.inkDark2, marginTop: 14 },
  kpHelper:    { fontSize: 12, color: C.inkDark3, letterSpacing: 0.3, marginTop: 'auto', paddingTop: 24 },
  kpHelperVal: { fontFamily: MONO, fontVariant: ['tabular-nums'], color: C.inkDark, fontWeight: '500' },
  kpPad:       { paddingHorizontal: 8, paddingTop: 14 },
  kpGrid:      { gap: 8 },
  kpRow:       { flexDirection: 'row', gap: 10 },
  kpKey:       { flex: 1, height: 48, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, shadowOpacity: 0, elevation: 0, alignItems: 'center', justifyContent: 'center' },
  kpKeyPressed:{ backgroundColor: 'rgba(255,255,255,0.14)' },
  kpKeyAux:    { backgroundColor: 'rgba(255,255,255,0.04)', shadowOpacity: 0, elevation: 0 },
  kpKeyAuxPressed: { backgroundColor: 'rgba(255,255,255,0.10)' },
  kpDigit:     { fontSize: 26, fontWeight: '400', letterSpacing: -0.3, color: C.inkDark, lineHeight: 30 },
  kpSub:       { fontSize: 9, fontWeight: '600', color: C.inkDark3, letterSpacing: 1.5, textTransform: 'uppercase', lineHeight: 11 },

  // ── Workout
  workout:     { flex: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 },
  woTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 4 },
  ghost:       { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  woSetRow:    { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  woSetNum:    { fontSize: 17, fontWeight: '500', color: C.inkDark, fontVariant: ['tabular-nums'], fontFamily: MONO },
  woSetOf:     { fontSize: 13, color: C.inkDark3, fontVariant: ['tabular-nums'], fontFamily: MONO },
  ringWrap:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ringContent: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 10 },
  phaseTag:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' },
  phaseTagRest:{},
  phaseTagText:{ fontSize: 11, letterSpacing: 2.5, fontWeight: '500', color: C.inkDark2 },
  dot:         { width: 6, height: 6, borderRadius: 3 },
  bigTime:     { fontSize: 72, fontWeight: '300', letterSpacing: -2, color: C.inkDark, fontVariant: ['tabular-nums'], fontFamily: MONO },
  bigTimeReady:{ fontSize: 108, fontWeight: '200' },
  upnext:      { fontSize: 13, letterSpacing: 0.5, color: C.inkDark2 },
  pause:       { height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  pauseText:   { fontSize: 15, fontWeight: '500', letterSpacing: 0.3, color: C.inkDark },

  lastCard:       { alignItems: 'center', gap: 8, paddingTop: 10 },
  lastCardLbl:    { fontSize: 10, letterSpacing: 2, fontWeight: '600', color: 'rgba(245,245,244,0.4)' },
  lastCardRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lastCardTime:   { fontSize: 20, fontWeight: '500', letterSpacing: -0.5, color: C.inkDark, fontFamily: MONO, fontVariant: ['tabular-nums'] },
  lastCardTarget: { fontSize: 11, color: 'rgba(245,245,244,0.4)', letterSpacing: 0.5 },

  // ── Distance Work View
  dw:           { flex: 1, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 28, backgroundColor: C.bgDark },
  dwTop:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  dwX:          { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  dwSetLbl:     { flex: 1, textAlign: 'center', fontSize: 11, letterSpacing: 3, fontWeight: '700', color: C.inkDark3 },
  dwSetNum:     { fontFamily: MONO, color: C.inkDark },
  dwSetOf:      { color: C.inkDark3 },
  dwStats:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: 36, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)', paddingBottom: 16 },
  dwStat:       { flex: 1, gap: 4 },
  dwStatVal:    { fontFamily: MONO, fontVariant: ['tabular-nums'], fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: C.inkDark },
  dwStatLbl:    { fontSize: 11, letterSpacing: 2.5, textTransform: 'uppercase', color: C.inkDark3 },
  dwMain:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  dwBig:        { fontFamily: MONO, fontVariant: ['tabular-nums'], fontSize: 96, fontWeight: '700', letterSpacing: -5, color: C.inkDark, lineHeight: 96 },
  dwUnit:       { fontSize: 13, color: C.inkDark2, letterSpacing: 0.3 },
  dwProgressWrap: { height: 2, marginHorizontal: 24, marginBottom: 18 },
  dwProgressTrack: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 2 },
  dwProgressFill:  { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.inkDark, borderRadius: 2 },
  dwBottom:     { alignItems: 'center', gap: 18, paddingBottom: 10 },
  dwPause:      { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.10)', alignItems: 'center', justifyContent: 'center' },
  dwDots:       { flexDirection: 'row', gap: 8 },
  dwDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  dwDotActive:  { backgroundColor: C.inkDark, transform: [{ scale: 1.3 }] },
  dwDotDone:    { backgroundColor: 'rgba(255,255,255,0.45)' },

  // ── Complete
  complete:     { flex: 1, paddingHorizontal: 28, paddingTop: 48, paddingBottom: 28 },
  completeHead: { gap: 10, paddingBottom: 24 },
  completeMark: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  completeTitle:{ fontSize: 28, fontWeight: '500', letterSpacing: -0.5, color: C.inkDark },
  completeAvg:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  completeAvgText: { fontSize: 12, color: C.inkDark2 },

  stats:   { flexDirection: 'row', width: '100%', justifyContent: 'space-between', paddingVertical: 18, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.10)', marginBottom: 18 },
  stat:    { gap: 4 },
  statVal: { fontSize: 22, fontVariant: ['tabular-nums'], letterSpacing: -0.5, color: C.inkDark, fontFamily: MONO },
  statLbl: { fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: C.inkDark3 },

  cbTitleRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 6, paddingBottom: 12, paddingTop: 4 },
  cbTitle:     { fontSize: 11, letterSpacing: 2.5, textTransform: 'uppercase', color: 'rgba(245,245,244,0.45)' },
  cbTargetText:{ fontFamily: MONO, fontVariant: ['tabular-nums'], fontSize: 11, color: 'rgba(245,245,244,0.55)' },
  cbScroll:    { flex: 1 },
  cbRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.14)' },
  cbIdx:       { width: 28, fontFamily: MONO, fontVariant: ['tabular-nums'], fontSize: 12, color: 'rgba(245,245,244,0.45)', fontWeight: '500' },
  cbTime:      { width: 56, fontFamily: MONO, fontVariant: ['tabular-nums'], fontSize: 15, fontWeight: '500', letterSpacing: -0.5, color: C.inkDark },

  // ── Delta badge
  badge:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeCompact:  { paddingHorizontal: 7, paddingVertical: 2 },
  badgeText:     { fontFamily: MONO, fontVariant: ['tabular-nums'], fontSize: 12, fontWeight: '600', letterSpacing: -0.1 },
  badgeTextSm:   { fontSize: 11 },

  // ── Delta bar
  dBar:          { height: 14, justifyContent: 'center' },
  dBarLine:      { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(20,22,26,0.12)' },
  dBarLineDark:  { backgroundColor: 'rgba(245,245,244,0.28)' },
  dBarCenter:    { position: 'absolute', left: '50%', top: 2, bottom: 2, width: 1, backgroundColor: 'rgba(20,22,26,0.28)', marginLeft: -0.5 },
  dBarCenterDark:{ backgroundColor: 'rgba(245,245,244,0.55)' },
  dBarDot:       { position: 'absolute', top: 3, width: 8, height: 8, borderRadius: 4, backgroundColor: C.inkDark, marginLeft: -4 },
  dBarDotDark:   { backgroundColor: '#F5F5F4' },

  // ── History / Detail shared
  lightScreen:   { flex: 1, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 28, backgroundColor: C.bgDark },
  histTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  histTopTitle:  { fontSize: 15, fontWeight: '500', letterSpacing: -0.1, color: C.inkDark },
  histHead:      { paddingHorizontal: 4, paddingBottom: 28 },
  histMeta:      { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginTop: 14 },
  histMetaNum:   { fontFamily: MONO, fontVariant: ['tabular-nums'], color: C.inkDark, fontWeight: '500', fontSize: 14 },
  histMetaLbl:   { color: C.inkDark3, fontSize: 13 },
  histMetaDot:   { color: C.inkDark3, marginHorizontal: 4 },
  histGroup:     { marginBottom: 22 },
  histBucket:    { fontSize: 11, letterSpacing: 2.5, textTransform: 'uppercase', color: C.inkDark3, paddingHorizontal: 4, paddingBottom: 12, paddingTop: 4 },
  histRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: DH },
  histRowLeft:   { gap: 4 },
  histRowDate:   { fontSize: 16, fontWeight: '500', letterSpacing: -0.2, color: C.inkDark },
  histRowSub:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  histRowSubTxt: { fontSize: 12, color: C.inkDark3 },
  sep:           { fontSize: 12, color: C.inkDark3, opacity: 0.5 },
  histRowRight:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  histRowTotal:  { fontFamily: MONO, fontVariant: ['tabular-nums'], fontSize: 16, fontWeight: '500', letterSpacing: -0.5, color: C.inkDark },

  // ── Detail
  detailHead:    { paddingHorizontal: 4, paddingBottom: 28 },
  detailTime:    { fontFamily: MONO, fontSize: 64, fontWeight: '300', letterSpacing: -2.5, fontVariant: ['tabular-nums'], lineHeight: 68, marginTop: 10, color: C.inkDark },
  timeline:      { marginBottom: 28 },
  timelineBar:   { flexDirection: 'row', height: 14, borderRadius: 999, overflow: 'hidden', gap: 2 },
  tlSeg:         { height: 14, borderRadius: 4 },
  timelineLegend:{ flexDirection: 'row', gap: 18, marginTop: 14 },
  legendItem:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendSwatch:  { width: 10, height: 10, borderRadius: 3 },
  legendText:    { fontSize: 12, color: C.inkDark2 },
})
