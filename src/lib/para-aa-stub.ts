function disabled() {
  throw new Error("Para account abstraction adapters are not enabled in this app.");
}

export const createAlchemySmartAccount = disabled;
export const createBiconomySmartAccount = disabled;
export const createCDPSmartAccount = disabled;
export const createGelatoSmartAccount = disabled;
export const createPimlicoSmartAccount = disabled;
export const createPortoSmartAccount = disabled;
export const createRhinestoneSmartAccount = disabled;
export const createSafeSmartAccount = disabled;
export const createThirdwebSmartAccount = disabled;
export const createZeroDevSmartAccount = disabled;
