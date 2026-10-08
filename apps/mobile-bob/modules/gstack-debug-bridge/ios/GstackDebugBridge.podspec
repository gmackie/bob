require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'GstackDebugBridge'
  s.version        = package['version']
  s.summary        = 'DEBUG-only gstack StateServer for the development client'
  s.description    = 'Vendored from gstack ios-qa. Touch synthesis derives from KIF (MIT).'
  s.homepage       = 'https://github.com/garrytan/gstack'
  s.license        = { :type => 'MIT' }
  s.author         = 'Gmacko'
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.source_files   = '*.{h,m,swift}'
  s.public_header_files = 'DebugBridgeTouch.h'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'SwiftUI', 'Network'
  # DEBUG must be set only for the Debug configuration. The source guards are
  # the release boundary: SwiftPM's debug filter does not apply to this pod.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS[config=Debug]' => '$(inherited) DEBUG',
    'GCC_PREPROCESSOR_DEFINITIONS[config=Debug]' => '$(inherited) DEBUG=1',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS[config=Release]' => '$(inherited)',
    'GCC_PREPROCESSOR_DEFINITIONS[config=Release]' => '$(inherited)',
  }
end
