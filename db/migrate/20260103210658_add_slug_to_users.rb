class AddSlugToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :slug, :string
    add_index :users, :slug, unique: true

    reversible do |dir|
      dir.up do
        User.find_each(&:save!)
      end
    end
  end
end
