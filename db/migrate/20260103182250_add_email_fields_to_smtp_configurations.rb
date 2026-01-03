class AddEmailFieldsToSmtpConfigurations < ActiveRecord::Migration[8.1]
  def change
    add_column :smtp_configurations, :from_email, :string
    add_column :smtp_configurations, :reply_to_email, :string
  end
end
