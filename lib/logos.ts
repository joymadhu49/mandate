import type { ImageSourcePropType } from 'react-native';

// Official issuer icons, pulled from each B20 token's onchain contractURI (ERC-7572)
// at https://metadata.coinbase.com/equity_icons/… and bundled for offline, instant render.
// SPCXc has no contractURI yet; its tile is composed from the SpaceX wordmark.
export const LOGOS: Record<string, ImageSourcePropType> = {
  AAPLc: require('@/assets/logos/AAPLc.png'),
  AMZNc: require('@/assets/logos/AMZNc.png'),
  COINc: require('@/assets/logos/COINc.png'),
  CRCLc: require('@/assets/logos/CRCLc.png'),
  GOOGLc: require('@/assets/logos/GOOGLc.png'),
  INTCc: require('@/assets/logos/INTCc.png'),
  METAc: require('@/assets/logos/METAc.png'),
  MSFTc: require('@/assets/logos/MSFTc.png'),
  MSTRc: require('@/assets/logos/MSTRc.png'),
  NVDAc: require('@/assets/logos/NVDAc.png'),
  SNDKc: require('@/assets/logos/SNDKc.png'),
  SPCXc: require('@/assets/logos/SPCXc.png'),
  TSLAc: require('@/assets/logos/TSLAc.png'),
};
