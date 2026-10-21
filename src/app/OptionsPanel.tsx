import { type ReactNode, useId } from 'react';
import { type OptionDef, type Options, type OptionValue, parseTime, type TimeOption } from '../core/options';
import { field, fieldLabel } from './ui';

interface OptionsPanelProps {
  defs: OptionDef[];
  values: Options;
  onChange: (key: string, value: OptionValue) => void;
}

export function OptionsPanel({ defs, values, onChange }: OptionsPanelProps) {
  if (defs.length === 0) return null;
  const controls: ReactNode[] = [];
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i] as OptionDef;
    const next = defs[i + 1];
    // A start and end time read best as one "Trim" control.
    if (def.kind === 'time' && next?.kind === 'time') {
      controls.push(<TrimControl key="trim" start={def} end={next} values={values} onChange={onChange} />);
      i++;
      continue;
    }
    controls.push(
      <OptionControl
        key={def.key}
        def={def}
        value={values[def.key] ?? def.default}
        disabled={def.kind === 'range' && def.disabledBy ? values[def.disabledBy] === true : false}
        onChange={(value) => onChange(def.key, value)}
      />,
    );
  }
  // One grid, so every label sits on one line and every control on the next, whatever the mix.
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-x-6 gap-y-5 border-t border-rule pt-5 @xl:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
      {controls}
    </div>
  );
}

interface TrimControlProps {
  start: TimeOption;
  end: TimeOption;
  values: Options;
  onChange: (key: string, value: OptionValue) => void;
}

const TRIM_HINT = 'Leave blank to keep the whole file.';

function TrimControl({ start, end, values, onChange }: TrimControlProps) {
  const startId = useId();
  const endId = useId();
  return (
    // Spans two tracks whenever there are two (the panel is at least 2 × 8.5rem plus a gap wide).
    <fieldset className="min-w-0 @min-[18.5rem]:col-span-2">
      <legend className={`${fieldLabel} mb-2`} title={TRIM_HINT}>
        Trim<span className="sr-only">. {TRIM_HINT}</span>
      </legend>
      <div className="flex items-center gap-2.5">
        <label htmlFor={startId} className="sr-only">
          {start.label}
        </label>
        <TimeInput
          id={startId}
          def={start}
          value={String(values[start.key] ?? '')}
          onChange={(v) => onChange(start.key, v)}
        />
        <span className="text-[0.8125rem] text-ink-3">to</span>
        <label htmlFor={endId} className="sr-only">
          {end.label}
        </label>
        <TimeInput id={endId} def={end} value={String(values[end.key] ?? '')} onChange={(v) => onChange(end.key, v)} />
      </div>
    </fieldset>
  );
}

function TimeInput({
  id,
  def,
  value,
  onChange,
}: {
  id: string;
  def: TimeOption;
  value: string;
  onChange: (value: string) => void;
}) {
  const invalid = value.trim() !== '' && parseTime(value) === undefined;
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      placeholder={def.placeholder}
      value={value}
      aria-invalid={invalid}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full min-w-0 tabular ${field} ${invalid ? 'border-danger hover:border-danger' : ''}`}
    />
  );
}

interface ControlProps {
  def: OptionDef;
  value: OptionValue;
  disabled: boolean;
  onChange: (value: OptionValue) => void;
}

function OptionControl({ def, value, disabled, onChange }: ControlProps) {
  const id = useId();
  const hintId = useId();
  // Hints show on hover; screen readers get them as the control's description.
  const label = (
    <label htmlFor={id} className={`${fieldLabel} mb-2 truncate`} title={def.hint}>
      {def.label}
    </label>
  );
  const describedBy = def.hint ? hintId : undefined;
  const hint = def.hint && (
    <span id={hintId} className="sr-only">
      {def.hint}
    </span>
  );

  switch (def.kind) {
    case 'select':
      return (
        <div className="min-w-0">
          {label}
          <select
            id={id}
            aria-describedby={describedBy}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className={`select w-full ${field}`}
          >
            {def.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          {hint}
        </div>
      );
    case 'range':
      return (
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            {label}
            <output htmlFor={id} className="text-[0.8125rem] leading-5 font-[600] tabular text-ink">
              {disabled ? '—' : String(value)}
            </output>
          </div>
          <input
            id={id}
            aria-describedby={describedBy}
            type="range"
            className="slider h-10 w-full"
            min={def.min}
            max={def.max}
            step={def.step}
            value={Number(value)}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {hint}
        </div>
      );
    case 'toggle':
      return (
        // Laid out like the other controls, its name above and the switch where their fields are.
        <label htmlFor={id} className="block min-w-0 cursor-pointer select-none" title={def.hint}>
          <span className={`${fieldLabel} mb-2 truncate`}>{def.label}</span>
          <span className="flex h-10 items-center gap-3">
            <input
              id={id}
              type="checkbox"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="relative h-6 w-10 shrink-0 rounded-full bg-rule-strong transition-colors peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-surface after:shadow-[0_1px_2px_rgb(0_0_0/0.2)] after:transition-transform peer-checked:after:translate-x-4"
            />
            {def.hint && <span className="text-[0.8125rem] leading-tight text-ink-3">{def.hint}</span>}
          </span>
        </label>
      );
    case 'color':
      return (
        <div className="min-w-0">
          {label}
          <div className={`flex items-center gap-2.5 ${field}`}>
            <input
              id={id}
              aria-describedby={describedBy}
              type="color"
              value={String(value)}
              onChange={(e) => onChange(e.target.value)}
              className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="tabular text-ink-2 uppercase">{String(value)}</span>
          </div>
          {hint}
        </div>
      );
    case 'time':
      return (
        <div className="min-w-0">
          {label}
          <TimeInput id={id} def={def} value={String(value)} onChange={onChange} />
        </div>
      );
  }
}
