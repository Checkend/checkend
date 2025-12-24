class AddDiscordWebhookUrlToApps < ActiveRecord::Migration[8.1]
  def change
    add_column :apps, :discord_webhook_url, :text
  end
end
