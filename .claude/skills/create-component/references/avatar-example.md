# Worked example — `Avatar/` (Spok mobile)

The full anatomy of a real component following the schema, from
`cc-mobile-react-native/src/components/ui/Avatar/`.

```
Avatar/
  Avatar.styles.tsx          # SIZE_MAP, ICON_SIZE_MAP, INDICATOR_SIZE_MAP, avatarStyles
  Avatar.types.ts            # AvatarSize | AvatarType | AvatarState | AvatarStatus | ...
  Avatar.tsx                 # AvatarProps + component; re-exports the type unions
  components/
    StatusIndicator/
      StatusIndicator.tsx
      index.ts
    index.ts
  index.ts
```

**`Avatar.types.ts`** — the type unions, nothing else:

```ts
import { type Size, tokens } from 'spok-react-sdk/theme'

export type AvatarSize = Size
export type AvatarType = 'picture' | 'user' | 'department' | 'group' | 'schedule' | 'initials'
export type AvatarState = 'default' | 'hover' | 'focused'
export type AvatarStatus = 'online' | 'offline'
export type AvatarInitialsColor = keyof typeof tokens.extraLayer
```

**`Avatar.styles.tsx`** — styleVariants + style-only maps, exported:

```tsx
import { tokens } from 'spok-react-sdk/theme'

import { styleVariants } from '@/theme/styles'

import type { AvatarSize, AvatarState } from './Avatar.types'

export const SIZE_MAP: Record<AvatarSize, number> = {
  '2xl': 64,
  xl: 56,
  lg: 48,
  md: 40,
  sm: 32,
  xs: 24,
}

type AvatarStyleVariantProps = {
  state: AvatarState
}

export const avatarStyles = styleVariants<AvatarStyleVariantProps>()({
  slots: {
    wrapper: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
  },
  defaultProps: {
    state: 'default',
  },
  variants: [
    {
      props: {
        state: 'hover',
      },
      style: {
        wrapper: {
          borderColor: tokens.stroke['lvl-1'],
          borderWidth: 1,
        },
      },
    },
  ],
})
```

**`Avatar.tsx`** — `Props` in the component file; imports styles, types,
and sub-components relatively; re-exports the type unions so the barrel
pulls everything from `./Avatar`:

```tsx
import { View } from 'react-native'

import { Icon } from '@/components/ui/Icon/Icon'
import { sx } from '@/theme/styles'

import { SIZE_MAP, avatarStyles } from './Avatar.styles'
import type { AvatarSize, AvatarState, AvatarType } from './Avatar.types'
import { StatusIndicator } from './components/StatusIndicator'

export type { AvatarSize, AvatarState, AvatarType }

export interface AvatarProps {
  size?: AvatarSize
  state?: AvatarState
  type?: AvatarType
  indicator?: boolean
  testID?: string
}

export const Avatar = (props: AvatarProps) => {
  const {
    indicator = false,
    size = 'md',
    state = 'default',
    type = 'user',
    testID,
  } = props

  const styles = avatarStyles({
    state,
  })

  // ...render
}
```

Note the deep sibling import (`@/components/ui/Icon/Icon`) — this file
lives *inside* the `@/components/ui` barrel's subtree, so it must not
import the barrel (imports-exports canon).

**`components/StatusIndicator/StatusIndicator.tsx`** — a sub-component
reaching its parent's shared maps/types with `../../`:

```tsx
import { View, ViewStyle } from 'react-native'

import { INDICATOR_SIZE_MAP } from '../../Avatar.styles'
import type { AvatarSize, AvatarStatus } from '../../Avatar.types'

export interface StatusIndicatorProps {
  size: AvatarSize
  status: AvatarStatus
}

export const StatusIndicator = (props: StatusIndicatorProps) => {
  const { size, status } = props
  // ...
}
```

**Barrels:**

```ts
// components/StatusIndicator/index.ts
export { StatusIndicator } from './StatusIndicator'
export type { StatusIndicatorProps } from './StatusIndicator'

// components/index.ts
export * from './StatusIndicator'

// Avatar/index.ts  (public surface)
export { Avatar } from './Avatar'
export type {
  AvatarProps,
  AvatarSize,
  AvatarType,
  AvatarState,
  AvatarStatus,
  AvatarInitialsColor,
} from './Avatar'
```

`StatusIndicator` is internal to `Avatar`, so it is **not** added to the
top-level `src/components/ui/index.ts` — only compound public parts
(like `Select`'s) surface there.

## Live exemplars to copy from

- **Context + compound parts:** `src/components/ui/Select/` and
  `src/components/ui/BottomSheet/` (`*.context.tsx`,
  `components/<Part>/`, master barrel).
- **utils/ extraction:** `src/components/ui/GroupAvatar/utils/layout.ts`,
  `src/features/chat/components/ChannelPreview/utils/`.
- **Pure adapter, no styles:** `src/features/chat/components/ChannelPreview/`
  (no `.styles.tsx`).
