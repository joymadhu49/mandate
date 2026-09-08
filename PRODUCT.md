# Product

<!-- impeccable:product-schema 1 -->

## Platform
ios

## Product Purpose
Mandate is a native iPhone app for managing a Coinbase-connected wallet and delegated tokenized-stock trading within user-authorized spending permissions.

## Operating Context
The builder tests on an iPhone 16 Plus connected to a local Node backend. Development defaults to simulated trades. OpenRouter configuration supports a personal development API key.

## Capabilities and Constraints
The app sections are Home, Agent, Orders, History, Settings, and Profile & Wallet. Agent supports OpenRouter chat, price-snapshot research, and explicit buy/sell proposals. New mandates default to chat confirmation; automatic mandates remain a separate option. Sign-out returns to Welcome. The welcome screen displays Mandate branding and a Coinbase-logo connection button. Balances come from the connected wallet. Profile labels are editable locally; wallet addresses and balances are not editable.

## Brand Commitments
Preserve the established dark interface, Coinbase blue actions, and the Mandate name. Use native bottom navigation, readable system typography, and hidden scroll indicators.
Welcome uses a text-only Mandate wordmark: the builder explicitly rejected the blue M badge. The installed icon should keep an upward/inverted-V silhouette, refined without background circles or construction guides.
Agent follows the builder's ChatGPT/Claude-like interaction preference: conversation first, a compact header and one composer, with configuration in a native sheet and clear trade-review cards.

## Implementation Assumptions
Orders represent agent-proposed trades. Pending trades can be cancelled; submitted transactions cannot. No response was received to the clarification, so this follows the explicit request for orders and cancellation. This is not an exchange limit-order product.

## Product Principles
Show real state, never fabricated balances or trades. Distinguish simulations clearly. Keep signing and financial authorization in the user's wallet. Preserve history across sign-out. Separate local display preferences from wallet identity.
