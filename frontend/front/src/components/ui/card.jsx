import { forwardRef } from 'react';
import { cn } from './utils';

export const Card = forwardRef(function Card({ className, as: Comp = 'div', ...props }, ref) {
    return <Comp ref={ref} className={cn('ui-card', className)} {...props} />;
});

export const CardHeader = forwardRef(function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('ui-card__header', className)} {...props} />;
});

export const CardContent = forwardRef(function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('ui-card__content', className)} {...props} />;
});
