class CreateTeamAssignments < ActiveRecord::Migration[8.1]
  def change
    create_table :team_assignments do |t|
      t.references :team, null: false, foreign_key: true
      t.references :app, null: false, foreign_key: true

      t.timestamps
    end

    add_index :team_assignments, [:team_id, :app_id], unique: true
  end
end
