module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') {
    return;
  }

  const { packager } = context;
  const safeName = packager.appInfo.productFilename;

  // Force Linux helpers to use the executable-safe name for /opt path creation.
  packager.appInfo.sanitizedProductName = safeName;
};
