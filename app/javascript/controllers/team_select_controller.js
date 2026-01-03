import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["select", "newTeamField", "newTeamInput", "submitButton"]

  connect() {
    this.toggle()
  }

  toggle() {
    const isNewTeam = this.selectTarget.value === "new"

    if (isNewTeam) {
      this.newTeamFieldTarget.classList.remove("hidden")
      this.newTeamInputTarget.required = true
      this.submitButtonTarget.textContent = "Create & Assign Team"
    } else {
      this.newTeamFieldTarget.classList.add("hidden")
      this.newTeamInputTarget.required = false
      this.newTeamInputTarget.value = ""
      this.submitButtonTarget.textContent = "Assign Team"
    }
  }
}
