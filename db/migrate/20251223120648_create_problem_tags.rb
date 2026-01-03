class CreateProblemTags < ActiveRecord::Migration[8.1]
  def change
    create_table :problem_tags do |t|
      t.references :problem, null: false, foreign_key: true
      t.references :tag, null: false, foreign_key: true

      t.timestamps
    end

    add_index :problem_tags, [ :problem_id, :tag_id ], unique: true
  end
end
