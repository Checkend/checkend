# Load custom Noticed delivery methods
Rails.application.config.to_prepare do
  require_relative '../../lib/noticed/delivery_methods/discord_delivery'
  require_relative '../../lib/noticed/delivery_methods/webhook_delivery'
  require_relative '../../lib/noticed/delivery_methods/git_hub_delivery'
end
