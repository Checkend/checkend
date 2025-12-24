class CreateSmtpConfigurations < ActiveRecord::Migration[8.1]
  def change
    create_table :smtp_configurations do |t|
      t.string :address
      t.integer :port
      t.string :domain
      t.string :user_name
      t.text :password  # Will be encrypted using Rails encrypts
      t.string :authentication, default: 'plain'
      t.boolean :enable_starttls_auto, default: true
      t.boolean :enabled, default: false

      t.timestamps
    end
  end
end
