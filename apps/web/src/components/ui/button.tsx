import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'brand' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonRounded = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  rounded?: ButtonRounded;
  children: ReactNode;
  isLoading?: boolean;
}

/* Every variant maps onto dash-btn in globals.css: primary and brand are the
   ink button, secondary and outline the outlined button, ghost a text button,
   danger the danger fill. `rounded` is kept so existing call sites compile;
   the shape is no longer per-call. */
const variantClasses: Record<ButtonVariant, string> = {
  primary: 'dash-btn--primary',
  brand: 'dash-btn--primary',
  secondary: 'dash-btn--secondary',
  outline: 'dash-btn--secondary',
  ghost: 'dash-btn--ghost',
  danger: 'dash-btn--danger',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      rounded: _rounded,
      children,
      isLoading,
      disabled,
      className = '',
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`dash-btn ${variantClasses[variant]} dash-btn--${size} ${className}`.trim()}
        {...props}
      >
        {isLoading && (
          <span
            className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
