'use client';

import type { ReactNode } from 'react';
import { cx } from './classnames.js';
import { formatMoneyMinor } from './format.js';
import { Icon, type IconName } from './icons.js';
import { StatusPill } from './status.js';

/**
 * Category → placeholder hue and icon.
 *
 * A store that has uploaded no photograph still needs a tile that reads as a
 * product rather than as a missing asset. The previous design drew the first
 * letter of the title in a circle, so a row of tomatoes, toor dal and toothpaste
 * were three identical `T`s. Drawn rather than set in emoji: the app's loaded
 * font families carry no emoji, so `🥬` arrived on screen as an empty box.
 */
const CATEGORY_PRESENTATION: Readonly<
  Record<string, { readonly hue: string; readonly icon: IconName }>
> = {
  FRUIT_VEGETABLE: { hue: 'var(--category-produce)', icon: 'leaf' },
  FRUITS_AND_VEGETABLES: { hue: 'var(--category-produce)', icon: 'leaf' },
  VEGETABLES: { hue: 'var(--category-produce)', icon: 'leaf' },
  FRUITS: { hue: 'var(--category-produce)', icon: 'leaf' },
  DAIRY: { hue: 'var(--category-dairy)', icon: 'bottle' },
  KIRANA: { hue: 'var(--category-grocery)', icon: 'sack' },
  GROCERY: { hue: 'var(--category-grocery)', icon: 'sack' },
  STAPLES: { hue: 'var(--category-grocery)', icon: 'sack' },
  BAKERY: { hue: 'var(--category-bakery)', icon: 'loaf' },
  SNACKS: { hue: 'var(--category-bakery)', icon: 'loaf' },
  MEAT_AND_SEAFOOD: { hue: 'var(--category-meat)', icon: 'fish' },
  HOUSEHOLD: { hue: 'var(--category-household)', icon: 'spray' },
  HOME_CARE: { hue: 'var(--category-household)', icon: 'spray' },
  SPECIALTY: { hue: 'var(--category-default)', icon: 'store' },
};

export function categoryPresentation(category: string): {
  readonly hue: string;
  readonly icon: IconName;
} {
  return (
    CATEGORY_PRESENTATION[category.toUpperCase()] ?? {
      hue: 'var(--category-default)',
      icon: 'basket',
    }
  );
}

export type ProductImageProps = {
  readonly title: string;
  readonly category: string;
  readonly src?: string | null | undefined;
  readonly className?: string | undefined;
  readonly size?: 'tile' | 'thumb' | 'hero' | undefined;
};

/**
 * A product image, or a designed stand-in when the store has uploaded none.
 *
 * The placeholder is decorative — the product name is always adjacent in the
 * tile — so it is hidden from assistive technology rather than announced as
 * "image of a green square".
 */
export function ProductImage({
  category,
  className,
  size = 'tile',
  src,
  title,
}: ProductImageProps) {
  const presentation = categoryPresentation(category);
  if (src) {
    return (
      <img
        alt={title}
        className={cx('ns-product-image', `ns-product-image--${size}`, className)}
        decoding="async"
        loading="lazy"
        src={src}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        'ns-product-image',
        'ns-product-image--placeholder',
        `ns-product-image--${size}`,
        className,
      )}
      style={{ '--placeholder-hue': presentation.hue } as Record<string, string>}
    >
      <span className="ns-product-image__glyph">
        <Icon name={presentation.icon} />
      </span>
    </span>
  );
}

export type QuantityStepperProps = {
  readonly quantity: number;
  readonly onChange: (next: number) => void;
  /** The product this stepper controls, so its buttons are self-describing. */
  readonly itemLabel: string;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly busy?: boolean | undefined;
  readonly className?: string | undefined;
  readonly size?: 'small' | 'medium' | undefined;
};

/**
 * Increase, decrease, remove.
 *
 * The customer app had no such control at all: a product card offered one "Add"
 * that always sent quantity 1, and the only way to change a quantity was on the
 * checkout screen. The live value is announced politely so a screen-reader user
 * hears the result of each press without the buttons losing focus.
 */
export function QuantityStepper({
  busy = false,
  className,
  itemLabel,
  max = 99,
  min = 0,
  onChange,
  quantity,
  size = 'medium',
}: QuantityStepperProps) {
  const decreaseLabel =
    quantity <= min + 1 && min === 0 ? `Remove ${itemLabel}` : `Decrease ${itemLabel}`;
  return (
    <div className={cx('ns-stepper', `ns-stepper--${size}`, className)}>
      <button
        aria-label={decreaseLabel}
        className="ns-stepper__button"
        disabled={busy || quantity <= min}
        onClick={() => onChange(quantity - 1)}
        type="button"
      >
        <Icon name={quantity <= min + 1 && min === 0 ? 'trash' : 'minus'} />
      </button>
      <output aria-live="polite" className="ns-stepper__value">
        <span className="sr-only">{itemLabel}: </span>
        {quantity}
      </output>
      <button
        aria-label={`Increase ${itemLabel}`}
        className="ns-stepper__button"
        disabled={busy || quantity >= max}
        onClick={() => onChange(quantity + 1)}
        type="button"
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

export type ProductTileProps = {
  readonly title: string;
  readonly category: string;
  readonly unitLabel: string;
  readonly priceMinor: number | null;
  readonly imageSrc?: string | null | undefined;
  /** Wire availability state; drives the pill and whether adding is possible. */
  readonly availabilityState?: string | null | undefined;
  readonly stale?: boolean | undefined;
  readonly variableWeight?: boolean | undefined;
  /** Quantity already in the basket. Zero renders the Add affordance. */
  readonly quantity: number;
  readonly onQuantityChange: (next: number) => void;
  readonly onOpen?: (() => void) | undefined;
  readonly busy?: boolean | undefined;
  readonly className?: string | undefined;
  readonly footer?: ReactNode | undefined;
};

/**
 * One product in a grid.
 *
 * Add flips to a stepper in place once the item is in the basket, which is the
 * pattern every shopper already knows and removes the round trip to the cart
 * screen just to change a quantity.
 */
export function ProductTile({
  availabilityState,
  busy = false,
  category,
  className,
  footer,
  imageSrc,
  onOpen,
  onQuantityChange,
  priceMinor,
  quantity,
  stale = false,
  title,
  unitLabel,
  variableWeight = false,
}: ProductTileProps) {
  const unavailable = priceMinor === null || stale || availabilityState === 'OUT_OF_STOCK';
  return (
    <article className={cx('ns-product', stale && 'ns-product--stale', className)}>
      <button className="ns-product__open" disabled={!onOpen} onClick={onOpen} type="button">
        <ProductImage category={category} src={imageSrc ?? null} title={title} />
        <span className="ns-product__title">{title}</span>
        <span className="ns-product__unit">
          {unitLabel}
          {variableWeight ? ' · final weight confirmed by the store' : ''}
        </span>
      </button>

      <div className="ns-product__meta">
        <strong className="ns-product__price">
          {priceMinor === null ? 'Price unavailable' : formatMoneyMinor(priceMinor, 'compact')}
        </strong>
        <StatusPill
          state={stale ? 'VENDOR_CONFIRMS' : (availabilityState ?? 'VENDOR_CONFIRMS')}
          {...(stale ? { label: 'Needs a refresh' } : {})}
        />
      </div>

      <div className="ns-product__action">
        {quantity > 0 ? (
          <QuantityStepper
            busy={busy}
            itemLabel={title}
            onChange={onQuantityChange}
            quantity={quantity}
            size="small"
          />
        ) : (
          <button
            className="ns-button ns-button--primary ns-button--small ns-button--block"
            disabled={busy || unavailable}
            onClick={() => onQuantityChange(1)}
            type="button"
          >
            <span className="ns-button__label">{unavailable ? 'Unavailable' : 'Add'}</span>
          </button>
        )}
      </div>
      {footer ? <div className="ns-product__footer">{footer}</div> : null}
    </article>
  );
}
