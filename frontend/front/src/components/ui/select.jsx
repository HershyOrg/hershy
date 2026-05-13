import { Children, forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './utils';

const flattenOptions = (children, groupLabel = null) => {
    const items = [];
    Children.forEach(children, (child) => {
        if (!child || !child.props) {
            return;
        }

        if (child.type === 'option') {
            items.push({
                type: 'option',
                value: child.props.value ?? '',
                label: child.props.children,
                disabled: Boolean(child.props.disabled),
                groupLabel
            });
            return;
        }

        if (child.type === 'optgroup') {
            items.push({ type: 'group', label: child.props.label });
            items.push(...flattenOptions(child.props.children, child.props.label));
        }
    });
    return items;
};

const toComparable = (value) => (value == null ? '' : String(value));

export const Select = forwardRef(function Select(
    {
        className,
        children,
        value,
        onChange,
        disabled,
        placeholder = '선택하세요',
        ...props
    },
    ref
) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef(null);

    const items = useMemo(() => flattenOptions(children), [children]);
    const options = useMemo(() => items.filter((item) => item.type === 'option'), [items]);

    const selected = useMemo(() => {
        const target = toComparable(value);
        return options.find((item) => toComparable(item.value) === target) || null;
    }, [options, value]);

    useEffect(() => {
        const onDocumentClick = (event) => {
            if (!wrapRef.current || wrapRef.current.contains(event.target)) {
                return;
            }
            setOpen(false);
        };

        const onEscape = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('mousedown', onDocumentClick);
        document.addEventListener('keydown', onEscape);
        return () => {
            document.removeEventListener('mousedown', onDocumentClick);
            document.removeEventListener('keydown', onEscape);
        };
    }, []);

    const selectOption = (nextValue) => {
        if (disabled) {
            return;
        }

        onChange?.({
            target: { value: nextValue, name: props.name },
            currentTarget: { value: nextValue, name: props.name }
        });
        setOpen(false);
    };

    const triggerLabel = selected?.label ?? placeholder;

    return (
        <div ref={wrapRef} className={cn('ui-select-wrap', className)}>
            <button
                ref={ref}
                type="button"
                className={cn('ui-select-trigger', open && 'is-open', disabled && 'is-disabled')}
                onClick={() => !disabled && setOpen((prev) => !prev)}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className={cn('ui-select-value', !selected && 'is-placeholder')}>{triggerLabel}</span>
                <span className="ui-select-icon" aria-hidden="true">▾</span>
            </button>

            {open && (
                <div className="ui-select-menu" role="listbox" aria-disabled={disabled || undefined}>
                    {items.length === 0 && <div className="ui-select-empty">항목 없음</div>}
                    {items.map((item, index) => {
                        if (item.type === 'group') {
                            return (
                                <div key={`group-${item.label}-${index}`} className="ui-select-option-group">
                                    {item.label}
                                </div>
                            );
                        }

                        const isSelected = toComparable(item.value) === toComparable(value);
                        return (
                            <button
                                key={`option-${toComparable(item.value)}-${index}`}
                                type="button"
                                className={cn('ui-select-option', isSelected && 'is-selected')}
                                onClick={() => selectOption(item.value)}
                                disabled={item.disabled}
                                role="option"
                                aria-selected={isSelected}
                            >
                                {item.label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
