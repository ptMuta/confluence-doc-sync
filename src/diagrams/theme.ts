import { z } from 'zod'

const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a #RRGGBB colour')
const value = z.union([z.string().regex(/^[^;=]*$/, 'Must not contain ; or ='), z.number()]).transform(String)

export const themeSchema = z.strictObject({
  version: z.number().int().positive(),
  background: color,
  font: z.strictObject({ family: z.string().trim().min(1), size: z.number().positive(), color }),
  roles: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/), value)),
})

export type Theme = z.output<typeof themeSchema>

const box = {
  whiteSpace: 'wrap',
  rounded: '1',
  arcSize: '14',
  strokeWidth: '2',
  spacing: '10',
  shadow: '1',
  fontStyle: '1',
  gradientDirection: 'south',
}
const card = (fill: string, gradient: string, stroke: string, text: string) => ({
  fillColor: fill,
  gradientColor: gradient,
  strokeColor: stroke,
  fontColor: text,
})
const group = {
  container: '1',
  collapsible: '0',
  whiteSpace: 'wrap',
  rounded: '1',
  arcSize: '4',
  verticalAlign: 'top',
  align: 'left',
  spacingLeft: '12',
  fontStyle: '1',
}
const line = {
  edgeStyle: 'orthogonalEdgeStyle',
  rounded: '1',
  arcSize: '16',
  orthogonalLoop: '1',
  jettySize: 'auto',
  strokeColor: '#475569',
  strokeWidth: '1.75',
  endArrow: 'block',
  endFill: '1',
  endSize: '7',
  fontColor: '#334155',
  fontSize: '11',
  fontStyle: '1',
  labelBackgroundColor: '#FFFFFF',
}

export const defaultTheme: Theme = {
  version: 1,
  background: '#FFFFFF',
  font: { family: 'Inter', size: 13, color: '#0F172A' },
  roles: {
    service: { ...box, ...card('#FFFFFF', '#E0E7FF', '#6366F1', '#312E81') },
    'data-store': {
      ...box,
      shape: 'cylinder3',
      boundedLbl: '1',
      backgroundOutline: '1',
      size: '12',
      ...card('#FFFFFF', '#D1FAE5', '#10B981', '#064E3B'),
    },
    queue: { ...box, arcSize: '50', ...card('#FFFFFF', '#FFEDD5', '#F97316', '#7C2D12') },
    actor: {
      shape: 'umlActor',
      verticalLabelPosition: 'bottom',
      verticalAlign: 'top',
      strokeWidth: '2',
      fontStyle: '1',
      fillColor: '#E2E8F0',
      strokeColor: '#334155',
      fontColor: '#0F172A',
    },
    external: {
      ...box,
      shadow: '0',
      dashed: '1',
      dashPattern: '6 4',
      ...card('#F8FAFC', 'none', '#94A3B8', '#475569'),
    },
    control: { ...box, ...card('#FFFFFF', '#FFE4E6', '#E11D48', '#881337') },
    zone: {
      ...group,
      shape: 'swimlane',
      startSize: '32',
      horizontal: '1',
      strokeWidth: '1',
      fillColor: '#1E293B',
      swimlaneFillColor: '#F8FAFC',
      strokeColor: '#CBD5E1',
      fontColor: '#FFFFFF',
      verticalAlign: 'middle',
    },
    boundary: {
      ...group,
      spacingTop: '6',
      strokeWidth: '2',
      dashed: '1',
      dashPattern: '8 4',
      fillColor: '#FFF1F2',
      strokeColor: '#FB7185',
      fontColor: '#BE123C',
    },
    note: {
      shape: 'note',
      whiteSpace: 'wrap',
      size: '14',
      spacing: '10',
      strokeWidth: '1',
      shadow: '1',
      fillColor: '#FEF9C3',
      strokeColor: '#EAB308',
      fontColor: '#713F12',
      align: 'left',
    },
    text: { text: '', whiteSpace: 'wrap', strokeColor: 'none', fillColor: 'none', fontColor: '#64748B' },
    flow: line,
    'flow-async': { ...line, dashed: '1', dashPattern: '6 4', strokeColor: '#F97316', fontColor: '#9A3412' },
  },
}
