import { Button } from './button';
import { Input } from './input';
import { cn } from './utils';

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export function NumberStepper({
    value,
    onChange,
    min = 0,
    step = 1,
    className,
    inputClassName,
    decrementLabel = '감소',
    incrementLabel = '증가'
}) {
    const base = toNumber(value, min);

    const apply = (next) => {
        const resolved = Math.max(min, Math.round(next));
        onChange?.(String(resolved));
    };

    return (
        <div className={cn('ui-stepper', className)}>
            <Button
                className="ui-stepper-btn"
                variant="secondary"
                onClick={() => apply(base - step)}
                aria-label={decrementLabel}
            >
                -
            </Button>
            <Input
                type="number"
                className={cn('ui-stepper-input', inputClassName)}
                value={value}
                onChange={(event) => onChange?.(event.target.value)}
            />
            <Button
                className="ui-stepper-btn"
                variant="secondary"
                onClick={() => apply(base + step)}
                aria-label={incrementLabel}
            >
                +
            </Button>
        </div>
    );
}
