import { forwardRef } from 'react';
import { cn } from './utils';

const buttonVariants = {
    default: 'ui-button--default',
    secondary: 'ui-button--secondary',
    ghost: 'ui-button--ghost',
    destructive: 'ui-button--destructive'
};

export const Button = forwardRef(function Button(
    {
        className,
        variant = 'default',
        type = 'button',
        ...props
    },
    ref
) {
    return (
        <button
            ref={ref}
            type={type}
            className={cn('ui-button', buttonVariants[variant] || buttonVariants.default, className)}
            {...props}
        />
    );
});
