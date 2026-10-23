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

const box = { whiteSpace: 'wrap', rounded: '1', arcSize: '10', strokeWidth: '1.5', spacing: '8' }
const group = {
  container: '1',
  collapsible: '0',
  whiteSpace: 'wrap',
  rounded: '1',
  arcSize: '3',
  verticalAlign: 'top',
  align: 'left',
  spacingLeft: '12',
  spacingTop: '6',
  fontStyle: '1',
}
const line = {
  edgeStyle: 'orthogonalEdgeStyle',
  rounded: '1',
  orthogonalLoop: '1',
  jettySize: 'auto',
  strokeColor: '#52606D',
  strokeWidth: '1.5',
  endArrow: 'blockThin',
  endFill: '1',
  endSize: '6',
  fontColor: '#52606D',
  fontSize: '11',
  labelBackgroundColor: '#FFFFFF',
}

export const defaultTheme: Theme = {
  version: 1,
  background: '#FFFFFF',
  font: { family: 'Inter', size: 13, color: '#1F2933' },
  roles: {
    service: { ...box, fillColor: '#EEF2FF', strokeColor: '#4F46E5', fontColor: '#1E1B4B' },
    'data-store': {
      shape: 'cylinder3',
      whiteSpace: 'wrap',
      boundedLbl: '1',
      backgroundOutline: '1',
      size: '10',
      strokeWidth: '1.5',
      fillColor: '#ECFDF5',
      strokeColor: '#059669',
      fontColor: '#064E3B',
    },
    queue: { ...box, arcSize: '50', fillColor: '#FFF7ED', strokeColor: '#EA580C', fontColor: '#7C2D12' },
    actor: {
      shape: 'umlActor',
      verticalLabelPosition: 'bottom',
      verticalAlign: 'top',
      strokeWidth: '1.5',
      fillColor: '#F1F5F9',
      strokeColor: '#475569',
      fontColor: '#1F2933',
    },
    external: {
      ...box,
      dashed: '1',
      dashPattern: '6 4',
      fillColor: '#F8FAFC',
      strokeColor: '#94A3B8',
      fontColor: '#475569',
    },
    control: { ...box, fillColor: '#FEF2F2', strokeColor: '#DC2626', fontColor: '#7F1D1D' },
    zone: { ...group, strokeWidth: '1', fillColor: '#F8FAFC', strokeColor: '#CBD5E1', fontColor: '#334155' },
    boundary: {
      ...group,
      strokeWidth: '1.5',
      dashed: '1',
      dashPattern: '8 4',
      fillColor: 'none',
      strokeColor: '#DC2626',
      fontColor: '#B91C1C',
    },
    note: {
      shape: 'note',
      whiteSpace: 'wrap',
      size: '12',
      spacing: '8',
      strokeWidth: '1',
      fillColor: '#FEFCE8',
      strokeColor: '#CA8A04',
      fontColor: '#713F12',
      align: 'left',
    },
    text: { text: '', whiteSpace: 'wrap', strokeColor: 'none', fillColor: 'none', fontColor: '#52606D' },
    flow: line,
    'flow-async': { ...line, dashed: '1', dashPattern: '6 4' },
  },
}
