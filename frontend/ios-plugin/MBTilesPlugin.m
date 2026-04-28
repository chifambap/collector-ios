#import <Capacitor/Capacitor.h>

// Objective-C bridge — registers the Swift MBTilesPlugin class and its methods
// with the Capacitor runtime. Required alongside the Swift implementation file.
CAP_PLUGIN(MBTilesPlugin, "MBTilesPlugin",
  CAP_PLUGIN_METHOD(pickAndImport, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(list,          CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getTile,       CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(importFromUrl, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(deleteFile,    CAPPluginReturnPromise);
)
