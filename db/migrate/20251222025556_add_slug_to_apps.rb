class AddSlugToApps < ActiveRecord::Migration[8.1]
  def change
    add_column :apps, :slug, :string
    add_index :apps, :slug, unique: true
  end
end
