import { type ReactNode, useId } from 'react';
import { type OptionDef, type Options, type OptionValue, parseTime, type TimeOption } from '../core/options';

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
  return <div className="flex flex-wrap items-end gap-x-8 gap-y-4">{controls}</div>;
}

interface TrimControlProps {
  start: TimeOption;
  end: TimeOption;
  values: Options;
  onChange: (key: string, value: OptionValue) => void;
}

function TrimControl({ start, end, values, onChange }: TrimControlProps) {
  const startId = useId();
  const endId = useId();
  return (
    <fieldset>
      <legend className="mb-1.5 text-[0.8125rem] text-ink-2" title="Leave blank to keep the whole file">
        Trim
      </legend>
      <div className="flex items-center gap-2">
        <label htmlFor={startId} className="sr-only">
          {start.label}
        </label>
        <TimeInput
          id={startId}
          def={start}
          value={String(values[start.key] ?? '')}
          onChange={(v) => onChange(start.key, v)}
        />
        <span className="text-ink-3">to</span>
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
      className={`w-24 tabular ${fieldClass} ${invalid ? 'border-danger' : ''}`}
    />
  );
}

interface ControlProps {
  def: OptionDef;
  value: OptionValue;
  disabled: boolean;
  onChange: (value: OptionValue) => void;
}

const fieldClass =
  'rounded-[10px] border border-rule-strong bg-surface px-3 py-2 text-ink outline-none transition-colors hover:border-ink-3 focus-visible:border-ink';

function OptionControl({ def, value, disabled, onChange }: ControlProps) {
  const id = useId();
  const label = (
    <label htmlFor={id} className="mb-1.5 block text-[0.8125rem] text-ink-2" title={def.hint}>
      {def.label}
    </label>
  );

  switch (def.kind) {
    case 'select':
      return (
        <div>
          {label}
          <select
            id={id}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            className={`select ${fieldClass}`}
          >
            {def.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>
      );
    case 'range':
      return (
        <div className="w-48">
          <div className="flex items-baseline justify-between">
            {label}
            <output htmlFor={id} className="text-[0.8125rem] tabular text-ink">
              {disabled ? '—' : String(value)}
            </output>
          </div>
          <input
            id={id}
            type="range"
            className="slider w-full"
            min={def.min}
            max={def.max}
            step={def.step}
            value={Number(value)}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </div>
      );
    case 'toggle':
      return (
        <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5 py-2 select-none" title={def.hint}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative h-5 w-9 rounded-full bg-rule-strong transition-colors peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-surface after:transition-transform peer-checked:after:translate-x-4"
          />
          <span className="text-ink">{def.label}</span>
          {def.hint && <span className="text-[0.8125rem] text-ink-3">{def.hint}</span>}
        </label>
      );
    case 'color':
      return (
        <div>
          {label}
          <div className={`flex items-center gap-2 ${fieldClass} py-1.5`}>
            <input
              id={id}
              type="color"
              value={String(value)}
              onChange={(e) => onChange(e.target.value)}
              className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <span className="tabular text-ink-2 uppercase">{String(value)}</span>
          </div>
        </div>
      );
    case 'time':
      return (
        <div>
          {label}
          <TimeInput id={id} def={def} value={String(value)} onChange={onChange} />
        </div>
      );
  }
}
