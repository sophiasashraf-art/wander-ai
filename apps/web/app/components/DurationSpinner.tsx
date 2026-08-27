'use client'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  label?: string
}

export default function DurationSpinner({ value, onChange, min = 1, max = 30, label = 'days' }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#E5E5E5] text-[#6B6B6B] hover:border-[#3D5AFE] hover:text-[#3D5AFE] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={e => {
          const n = Number(e.target.value)
          if (n >= min && n <= max) onChange(n)
        }}
        className="w-10 bg-transparent outline-none text-[#0A0A0A] text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#E5E5E5] text-[#6B6B6B] hover:border-[#3D5AFE] hover:text-[#3D5AFE] transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-sm font-medium"
      >
        +
      </button>
      <span className="text-sm text-[#6B6B6B]">{label}</span>
    </div>
  )
}
