Pod::Spec.new do |s|
  s.name           = 'BobLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Starts and ends Bob SDLC Live Activities and reports their push tokens (GMA-774).'
  s.author         = 'Bob'
  s.homepage       = 'https://bob.blder.bot'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
