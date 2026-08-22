import type { JSX } from "preact";

type IconProps = { size?: number } & JSX.SVGAttributes<SVGSVGElement>;

function Icon({ size = 20, children, ...rest }: IconProps & { children: preact.ComponentChildren }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SessionsIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Icon>
);

export const DeviceIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" />
    <path d="M7.5 9h9M7.5 12.5h5" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const BackIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 5l-7 7 7 7" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L20 20" />
  </Icon>
);

export const RefreshIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 8a7.5 7.5 0 10.5 7" />
    <path d="M19 3v5h-5" />
  </Icon>
);

export const ExpandIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

export const EjectIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5L4.5 12h15L12 3.5z" />
    <path d="M4.5 16.5h15v4h-15z" />
  </Icon>
);

export const CalibrationIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="6.5" width="17" height="11" />
    <path d="M3.5 10h17M3.5 14h17M9 6.5v11M15 6.5v11" />
  </Icon>
);

export const DownloadIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v10M8 10.5l4 4 4-4" />
    <path d="M4.5 16v3.5h15V16" />
  </Icon>
);
