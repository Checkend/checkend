class CreateTeamMembers < ActiveRecord::Migration[8.1]
  def change
    create_table :team_members do |t|
      t.references :team, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.string :role, default: 'member', null: false

      t.timestamps
    end

    add_index :team_members, [ :team_id, :user_id ], unique: true
  end
end
