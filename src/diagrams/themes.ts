import { studio, type Theme } from './theme.ts'

const r = studio.roles
const set = (over: Record<string, Record<string, string>>) =>
  Object.fromEntries(Object.entries(r).map(([key, role]) => [key, { ...role, ...over[key] }]))
const fill = (f: string, g: string, s: string, t: string) => ({
  fillColor: f,
  gradientColor: g,
  strokeColor: s,
  fontColor: t,
})

const midnight: Theme = {
  version: 1,
  background: '#1E1E2E',
  font: { family: 'Inter', size: 13, color: '#CDD6F4' },
  roles: set({
    service: { ...fill('#313244', '#28283D', '#89B4FA', '#CDD6F4'), shadow: '0' },
    'data-store': { ...fill('#313244', '#28283D', '#A6E3A1', '#CDD6F4'), shadow: '0' },
    queue: { ...fill('#313244', '#28283D', '#FAB387', '#CDD6F4'), shadow: '0' },
    control: { ...fill('#313244', '#28283D', '#F38BA8', '#CDD6F4'), shadow: '0' },
    actor: { fillColor: '#45475A', strokeColor: '#BAC2DE', fontColor: '#CDD6F4' },
    external: fill('#1E1E2E', 'none', '#7F849C', '#A6ADC8'),
    zone: { fillColor: '#45475A', swimlaneFillColor: '#181825', strokeColor: '#45475A', fontColor: '#CDD6F4' },
    boundary: { fillColor: '#2A1F2D', strokeColor: '#F38BA8', fontColor: '#F38BA8' },
    note: { fillColor: '#F9E2AF', strokeColor: '#F9E2AF', fontColor: '#1E1E2E', shadow: '0' },
    icon: { tileFill: '#313244', tileStroke: '#45475A', iconColor: '#89B4FA', fontColor: '#CDD6F4' },
    text: { fontColor: '#A6ADC8' },
    flow: { strokeColor: '#BAC2DE', fontColor: '#CDD6F4', labelBackgroundColor: '#1E1E2E' },
    'flow-async': { strokeColor: '#FAB387', fontColor: '#FAB387', labelBackgroundColor: '#1E1E2E' },
  }),
}

const solid = (f: string) => ({
  fillColor: f,
  gradientColor: 'none',
  strokeColor: f,
  fontColor: '#FFFFFF',
  shadow: '0',
})
const bold: Theme = {
  version: 1,
  background: '#FFFFFF',
  font: { family: 'Inter', size: 13, color: '#0F172A' },
  roles: set({
    service: solid('#4F46E5'),
    'data-store': solid('#059669'),
    queue: solid('#EA580C'),
    control: solid('#E11D48'),
    actor: { fillColor: '#0F172A', strokeColor: '#0F172A' },
    external: { ...solid('#E2E8F0'), strokeColor: '#64748B', fontColor: '#334155' },
    zone: { fillColor: '#0F172A', swimlaneFillColor: '#F1F5F9', strokeColor: '#0F172A', strokeWidth: '2' },
    boundary: { fillColor: '#FFE4E6', strokeColor: '#E11D48' },
    icon: { tileFill: '#4F46E5', tileStroke: 'none', iconColor: '#FFFFFF' },
    note: { fillColor: '#FACC15', strokeColor: '#FACC15', fontColor: '#422006', shadow: '0' },
    flow: { strokeColor: '#0F172A', fontColor: '#0F172A', strokeWidth: '2' },
    'flow-async': { strokeColor: '#EA580C', fontColor: '#9A3412', strokeWidth: '2' },
  }),
}

const rough = { sketch: '1', curveFitting: '1', jiggle: '2', shadow: '0', gradientColor: 'none' }
const hatch = (f: string, s: string) => ({
  ...rough,
  fillStyle: 'hachure',
  fillColor: f,
  strokeColor: s,
  fontColor: '#1E1E1E',
})
const sketch: Theme = {
  version: 1,
  background: '#FFFFFF',
  font: { family: 'Inter', size: 14, color: '#1E1E1E' },
  roles: Object.fromEntries(
    Object.entries(
      set({
        service: hatch('#A5D8FF', '#1971C2'),
        'data-store': hatch('#B2F2BB', '#2F9E44'),
        queue: hatch('#FFD8A8', '#E8590C'),
        control: hatch('#FFC9C9', '#E03131'),
        actor: { ...rough, fillColor: '#E9ECEF', strokeColor: '#1E1E1E' },
        external: { ...rough, fillColor: 'none', strokeColor: '#868E96', fontColor: '#495057' },
        zone: {
          ...rough,
          fillStyle: 'solid',
          fillColor: '#E9ECEF',
          swimlaneFillColor: '#F8F9FA',
          strokeColor: '#ADB5BD',
          fontColor: '#1E1E1E',
        },
        boundary: { ...rough, fillColor: 'none', strokeColor: '#E03131', fontColor: '#C92A2A' },
        icon: { tileFill: '#FFFFFF', tileStroke: '#1E1E1E', iconColor: '#1971C2' },
        note: { ...rough, fillStyle: 'solid', fillColor: '#FFEC99', strokeColor: '#F08C00' },
        flow: { ...rough, strokeColor: '#1E1E1E', fontColor: '#1E1E1E', edgeStyle: 'none', curved: '1' },
        'flow-async': { ...rough, strokeColor: '#E8590C', fontColor: '#E8590C', edgeStyle: 'none', curved: '1' },
      }),
    ).map(([k, v]) => [k, { ...v, fontStyle: '0' }]),
  ),
}

const line = (stroke: string, text: string, bg: string) => ({
  strokeColor: stroke,
  fontColor: text,
  labelBackgroundColor: bg,
})
const blueprint: Theme = {
  version: 1,
  background: '#0B2545',
  font: { family: 'Inter', size: 13, color: '#E0F2FE' },
  roles: set({
    service: { ...fill('#13315C', 'none', '#7DD3FC', '#E0F2FE'), shadow: '0' },
    'data-store': { ...fill('#13315C', 'none', '#7DD3FC', '#E0F2FE'), shadow: '0' },
    queue: { ...fill('#13315C', 'none', '#7DD3FC', '#E0F2FE'), shadow: '0' },
    control: { ...fill('#13315C', 'none', '#FCA5A5', '#FEE2E2'), shadow: '0' },
    actor: { fillColor: 'none', strokeColor: '#E0F2FE', fontColor: '#E0F2FE' },
    external: fill('none', 'none', '#7DD3FC', '#BAE6FD'),
    zone: { fillColor: '#134074', swimlaneFillColor: '#0B2545', strokeColor: '#7DD3FC', fontColor: '#E0F2FE' },
    boundary: { fillColor: 'none', strokeColor: '#FCA5A5', fontColor: '#FCA5A5' },
    note: { fillColor: '#13315C', strokeColor: '#E0F2FE', fontColor: '#E0F2FE', shadow: '0' },
    icon: { tileFill: '#13315C', tileStroke: '#7DD3FC', iconColor: '#E0F2FE', fontColor: '#E0F2FE' },
    text: { fontColor: '#7DD3FC' },
    flow: line('#E0F2FE', '#E0F2FE', '#0B2545'),
    'flow-async': line('#FDE68A', '#FDE68A', '#0B2545'),
  }),
}

const nord: Theme = {
  version: 1,
  background: '#ECEFF4',
  font: { family: 'Inter', size: 13, color: '#2E3440' },
  roles: set({
    service: { ...fill('#FFFFFF', 'none', '#5E81AC', '#2E3440'), shadow: '0' },
    'data-store': { ...fill('#FFFFFF', 'none', '#A3BE8C', '#2E3440'), shadow: '0' },
    queue: { ...fill('#FFFFFF', 'none', '#D08770', '#2E3440'), shadow: '0' },
    control: { ...fill('#FFFFFF', 'none', '#BF616A', '#2E3440'), shadow: '0' },
    actor: { fillColor: '#D8DEE9', strokeColor: '#4C566A', fontColor: '#2E3440' },
    external: fill('#E5E9F0', 'none', '#81A1C1', '#4C566A'),
    zone: { fillColor: '#4C566A', swimlaneFillColor: '#E5E9F0', strokeColor: '#D8DEE9', fontColor: '#ECEFF4' },
    boundary: { fillColor: 'none', strokeColor: '#BF616A', fontColor: '#BF616A' },
    note: { fillColor: '#EBCB8B', strokeColor: '#EBCB8B', fontColor: '#2E3440', shadow: '0' },
    icon: { tileFill: '#FFFFFF', tileStroke: '#D8DEE9', iconColor: '#5E81AC', fontColor: '#2E3440' },
    text: { fontColor: '#4C566A' },
    flow: line('#4C566A', '#2E3440', '#ECEFF4'),
    'flow-async': line('#D08770', '#A15C46', '#ECEFF4'),
  }),
}

const square = { rounded: '0', shadow: '0', gradientColor: 'none', strokeWidth: '1.5' }
const carbon: Theme = {
  version: 1,
  background: '#FFFFFF',
  font: { family: 'Inter', size: 13, color: '#161616' },
  roles: set({
    service: { ...square, fillColor: '#FFFFFF', strokeColor: '#0F62FE', fontColor: '#161616', strokeWidth: '2' },
    'data-store': { ...square, fillColor: '#F4F4F4', strokeColor: '#161616', fontColor: '#161616' },
    queue: {
      ...square,
      arcSize: '50',
      rounded: '1',
      fillColor: '#F4F4F4',
      strokeColor: '#161616',
      fontColor: '#161616',
    },
    control: { ...square, fillColor: '#FFFFFF', strokeColor: '#DA1E28', fontColor: '#161616', strokeWidth: '2' },
    actor: { fillColor: '#FFFFFF', strokeColor: '#161616', fontColor: '#161616' },
    external: { ...square, fillColor: '#FFFFFF', strokeColor: '#8D8D8D', fontColor: '#525252' },
    zone: {
      rounded: '0',
      fillColor: '#161616',
      swimlaneFillColor: '#FFFFFF',
      strokeColor: '#161616',
      fontColor: '#FFFFFF',
    },
    boundary: { rounded: '0', fillColor: 'none', strokeColor: '#DA1E28', fontColor: '#DA1E28' },
    note: { fillColor: '#F4F4F4', strokeColor: '#8D8D8D', fontColor: '#161616', shadow: '0' },
    icon: { tileFill: '#FFFFFF', tileStroke: '#161616', iconColor: '#0F62FE', arcSize: '0', fontColor: '#161616' },
    text: { fontColor: '#525252' },
    flow: { ...line('#161616', '#161616', '#FFFFFF'), rounded: '0' },
    'flow-async': { ...line('#0F62FE', '#0F62FE', '#FFFFFF'), rounded: '0' },
  }),
}

const glow = (from: string, to: string) => ({
  ...fill(from, to, to, '#FFFFFF'),
  strokeWidth: '0',
  gradientDirection: 'east',
  shadow: '1',
})
const aurora: Theme = {
  version: 1,
  background: '#0B1020',
  font: { family: 'Inter', size: 13, color: '#E2E8F0' },
  roles: set({
    service: glow('#6366F1', '#A855F7'),
    'data-store': glow('#10B981', '#06B6D4'),
    queue: glow('#F59E0B', '#EF4444'),
    control: glow('#F43F5E', '#EC4899'),
    actor: { fillColor: '#1E293B', strokeColor: '#E2E8F0', fontColor: '#E2E8F0' },
    external: fill('#111827', 'none', '#475569', '#94A3B8'),
    zone: { fillColor: '#1E293B', swimlaneFillColor: '#0F172A', strokeColor: '#1E293B', fontColor: '#E2E8F0' },
    boundary: { fillColor: 'none', strokeColor: '#A855F7', fontColor: '#C4B5FD' },
    note: { fillColor: '#1E293B', strokeColor: '#FBBF24', fontColor: '#FDE68A', shadow: '0' },
    icon: { tileFill: '#1E293B', tileStroke: '#334155', iconColor: '#A5B4FC', fontColor: '#E2E8F0' },
    text: { fontColor: '#94A3B8' },
    flow: line('#94A3B8', '#E2E8F0', '#0B1020'),
    'flow-async': line('#F59E0B', '#FCD34D', '#0B1020'),
  }),
}

const soft = (f: string, t: string) => ({
  fillColor: f,
  gradientColor: 'none',
  strokeColor: 'none',
  fontColor: t,
  shadow: '0',
  arcSize: '24',
})
const pastel: Theme = {
  version: 1,
  background: '#FFFFFF',
  font: { family: 'Inter', size: 13, color: '#1F2937' },
  roles: set({
    service: soft('#DBEAFE', '#1E3A8A'),
    'data-store': { ...soft('#D1FAE5', '#065F46'), strokeColor: '#D1FAE5' },
    queue: { ...soft('#FFEDD5', '#9A3412'), arcSize: '50' },
    control: soft('#FFE4E6', '#9F1239'),
    actor: { fillColor: '#E5E7EB', strokeColor: '#6B7280', fontColor: '#1F2937' },
    external: { ...soft('#F3F4F6', '#4B5563'), dashed: '0' },
    zone: {
      fillColor: '#EDE9FE',
      swimlaneFillColor: '#FAF5FF',
      strokeColor: 'none',
      fontColor: '#5B21B6',
      arcSize: '6',
    },
    boundary: { fillColor: '#FFF1F2', strokeColor: '#FDA4AF', fontColor: '#BE123C' },
    note: { fillColor: '#FEF9C3', strokeColor: 'none', fontColor: '#713F12', shadow: '0' },
    icon: { tileFill: '#DBEAFE', tileStroke: 'none', iconColor: '#1E3A8A', fontColor: '#1F2937' },
    text: { fontColor: '#6B7280' },
    flow: line('#9CA3AF', '#374151', '#FFFFFF'),
    'flow-async': line('#FDBA74', '#9A3412', '#FFFFFF'),
  }),
}

export const themes = { studio, midnight, bold, sketch, blueprint, nord, carbon, aurora, pastel }

export type ThemeName = keyof typeof themes

export const themeNames = Object.keys(themes) as [ThemeName, ...ThemeName[]]

export const defaultTheme = nord
