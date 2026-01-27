import { Button, type ButtonProps } from '@/shared/ui/Button/Button';

export type YouTubeLikeClaimButtonProps = ButtonProps & {
  label?: string;
  isLoading?: boolean;
};

export const YouTubeLikeClaimButton = ({
  label = 'Получить лайк',
  isLoading = false,
  disabled,
  variant = 'secondary',
  size = 'sm',
  ...props
}: YouTubeLikeClaimButtonProps) => {
  return (
    <Button {...props} variant={variant} size={size} disabled={disabled || isLoading}>
      {isLoading ? '...' : label}
    </Button>
  );
};
